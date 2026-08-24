CREATE TABLE IF NOT EXISTS "jobs"."job_retry_request" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  source_job_id uuid NOT NULL REFERENCES "jobs"."job"(id),
  idempotency_key uuid NOT NULL UNIQUE,
  new_job_id uuid NOT NULL UNIQUE REFERENCES "jobs"."job"(id),
  actor_user_id uuid NULL,
  reason varchar(1000) NOT NULL,
  created_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CONSTRAINT jobs_job_retry_request_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7)
);

CREATE INDEX IF NOT EXISTS jobs_job_retry_request_source_idx
  ON "jobs"."job_retry_request" (source_job_id);

CREATE OR REPLACE FUNCTION "jobs".assert_jobs_runtime()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, jobs
AS $$
BEGIN
  IF session_user IN ('postgres', 'project_migrator') THEN
    RETURN;
  END IF;
  PERFORM "jobs".assert_worker_target('jobs');
END;
$$;

CREATE OR REPLACE FUNCTION "jobs".sync_job_schedule(
  p_code varchar,
  p_job_type varchar,
  p_job_version integer,
  p_cron_expression varchar,
  p_timezone varchar,
  p_enabled boolean,
  p_next_run_at timestamp
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, jobs
AS $$
BEGIN
  PERFORM "jobs".assert_jobs_runtime();

  INSERT INTO "jobs"."job_schedule" (
    code, job_type, job_version, cron_expression, timezone, enabled, next_run_at
  ) VALUES (
    p_code, p_job_type, p_job_version, p_cron_expression, p_timezone,
    p_enabled, p_next_run_at
  )
  ON CONFLICT (code) DO UPDATE SET
    job_type = EXCLUDED.job_type,
    job_version = EXCLUDED.job_version,
    cron_expression = EXCLUDED.cron_expression,
    timezone = EXCLUDED.timezone,
    enabled = EXCLUDED.enabled,
    next_run_at = CASE
      WHEN "jobs"."job_schedule".job_type IS DISTINCT FROM EXCLUDED.job_type
        OR "jobs"."job_schedule".job_version IS DISTINCT FROM EXCLUDED.job_version
        OR "jobs"."job_schedule".cron_expression IS DISTINCT FROM EXCLUDED.cron_expression
        OR "jobs"."job_schedule".timezone IS DISTINCT FROM EXCLUDED.timezone
        OR "jobs"."job_schedule".next_run_at IS NULL
      THEN EXCLUDED.next_run_at
      ELSE "jobs"."job_schedule".next_run_at
    END,
    updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
END;
$$;

CREATE OR REPLACE FUNCTION "jobs".disable_missing_job_schedules(
  p_codes jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, jobs
AS $$
DECLARE
  changed integer;
BEGIN
  PERFORM "jobs".assert_jobs_runtime();

  UPDATE "jobs"."job_schedule" AS schedule
  SET enabled = false,
      updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
  WHERE schedule.enabled = true
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(COALESCE(p_codes, '[]'::jsonb)) AS registered(code)
      WHERE registered.code = schedule.code
    );

  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;

CREATE OR REPLACE FUNCTION "jobs".claim_due_schedules(
  p_scheduler_id varchar,
  p_now timestamp DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  p_limit integer DEFAULT 10,
  p_lease_ms integer DEFAULT 30000
) RETURNS SETOF "jobs"."job_schedule"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, jobs
AS $$
BEGIN
  PERFORM "jobs".assert_jobs_runtime();

  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM "jobs"."job_schedule"
    WHERE enabled = true
      AND next_run_at IS NOT NULL
      AND next_run_at <= p_now
      AND (lease_expires_at IS NULL OR lease_expires_at < p_now)
    ORDER BY next_run_at, code
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE "jobs"."job_schedule" AS schedule
  SET locked_by = p_scheduler_id,
      locked_at = p_now,
      lease_expires_at = p_now + (p_lease_ms * interval '1 millisecond'),
      updated_at = p_now
  FROM candidates
  WHERE schedule.id = candidates.id
  RETURNING schedule.*;
END;
$$;

CREATE OR REPLACE FUNCTION "jobs".complete_job_schedule(
  p_code varchar,
  p_scheduler_id varchar,
  p_last_run_at timestamp,
  p_next_run_at timestamp
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, jobs
AS $$
BEGIN
  PERFORM "jobs".assert_jobs_runtime();

  UPDATE "jobs"."job_schedule"
  SET last_run_at = p_last_run_at,
      next_run_at = p_next_run_at,
      locked_by = NULL,
      locked_at = NULL,
      lease_expires_at = NULL,
      updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
  WHERE code = p_code
    AND locked_by = p_scheduler_id;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION "jobs".cleanup_terminal_jobs(
  p_before timestamp,
  p_batch_size integer DEFAULT 500
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, jobs
AS $$
DECLARE
  removed integer;
BEGIN
  PERFORM "jobs".assert_jobs_runtime();

  WITH candidates AS (
    SELECT id
    FROM "jobs"."job"
    WHERE status IN ('completed', 'failed')
      AND updated_at < p_before
    ORDER BY updated_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  ), deleted AS (
    DELETE FROM "jobs"."job" AS job
    USING candidates
    WHERE job.id = candidates.id
    RETURNING job.id
  )
  SELECT count(*)::integer INTO removed FROM deleted;

  RETURN removed;
END;
$$;

CREATE OR REPLACE FUNCTION "jobs".manual_retry_job(
  p_source_job_id uuid,
  p_idempotency_key uuid,
  p_reason varchar,
  p_actor_user_id uuid DEFAULT NULL
) RETURNS "jobs"."job"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, jobs
AS $$
DECLARE
  source_job "jobs"."job";
  retry_request "jobs"."job_retry_request";
  result "jobs"."job";
  derived_key varchar(255);
BEGIN
  PERFORM "jobs".assert_jobs_runtime();

  IF length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'manual retry reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO source_job
  FROM "jobs"."job"
  WHERE id = p_source_job_id
  FOR UPDATE;

  IF source_job.id IS NULL THEN
    RAISE EXCEPTION 'job not found' USING ERRCODE = 'P0002';
  END IF;
  IF source_job.status <> 'failed' THEN
    RAISE EXCEPTION 'only failed jobs can be retried' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO retry_request
  FROM "jobs"."job_retry_request"
  WHERE idempotency_key = p_idempotency_key;

  IF retry_request.id IS NOT NULL THEN
    SELECT * INTO result FROM "jobs"."job" WHERE id = retry_request.new_job_id;
    RETURN result;
  END IF;

  derived_key := left(source_job.idempotency_key || ':manual:' || p_idempotency_key::varchar, 255);
  INSERT INTO "jobs"."job" (
    type, version, payload, source_service, target_service,
    idempotency_key, correlation_id, actor_user_id, priority, run_at,
    max_attempts, schedule_code, retry_of_job_id
  ) VALUES (
    source_job.type, source_job.version, source_job.payload,
    source_job.source_service, source_job.target_service,
    derived_key, source_job.correlation_id, p_actor_user_id,
    source_job.priority, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    source_job.max_attempts, source_job.schedule_code, source_job.id
  ) RETURNING * INTO result;

  INSERT INTO "jobs"."job_retry_request" (
    source_job_id, idempotency_key, new_job_id, actor_user_id, reason
  ) VALUES (
    p_source_job_id, p_idempotency_key, result.id, p_actor_user_id, left(trim(p_reason), 1000)
  );

  RETURN result;
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO retry_request
  FROM "jobs"."job_retry_request"
  WHERE idempotency_key = p_idempotency_key;
  IF retry_request.id IS NULL THEN
    RAISE;
  END IF;
  SELECT * INTO result FROM "jobs"."job" WHERE id = retry_request.new_job_id;
  RETURN result;
END;
$$;

REVOKE ALL ON TABLE "jobs"."job_retry_request" FROM PUBLIC;
REVOKE ALL ON FUNCTION "jobs".assert_jobs_runtime() FROM PUBLIC;
REVOKE ALL ON FUNCTION "jobs".sync_job_schedule(varchar, varchar, integer, varchar, varchar, boolean, timestamp) FROM PUBLIC;
REVOKE ALL ON FUNCTION "jobs".disable_missing_job_schedules(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION "jobs".claim_due_schedules(varchar, timestamp, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "jobs".complete_job_schedule(varchar, varchar, timestamp, timestamp) FROM PUBLIC;
REVOKE ALL ON FUNCTION "jobs".cleanup_terminal_jobs(timestamp, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "jobs".manual_retry_job(uuid, uuid, varchar, uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_jobs_runtime') THEN
    GRANT SELECT, INSERT ON "jobs"."job_retry_request" TO "project_jobs_runtime";
    GRANT EXECUTE ON FUNCTION "jobs".assert_jobs_runtime() TO "project_jobs_runtime";
    GRANT EXECUTE ON FUNCTION "jobs".sync_job_schedule(varchar, varchar, integer, varchar, varchar, boolean, timestamp) TO "project_jobs_runtime";
    GRANT EXECUTE ON FUNCTION "jobs".disable_missing_job_schedules(jsonb) TO "project_jobs_runtime";
    GRANT EXECUTE ON FUNCTION "jobs".claim_due_schedules(varchar, timestamp, integer, integer) TO "project_jobs_runtime";
    GRANT EXECUTE ON FUNCTION "jobs".complete_job_schedule(varchar, varchar, timestamp, timestamp) TO "project_jobs_runtime";
    GRANT EXECUTE ON FUNCTION "jobs".cleanup_terminal_jobs(timestamp, integer) TO "project_jobs_runtime";
    GRANT EXECUTE ON FUNCTION "jobs".manual_retry_job(uuid, uuid, varchar, uuid) TO "project_jobs_runtime";
  END IF;
END
$$;
