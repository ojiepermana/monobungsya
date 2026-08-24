CREATE TABLE IF NOT EXISTS "jobs"."job_schedule" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  code varchar(150) NOT NULL UNIQUE,
  job_type varchar(100) NOT NULL,
  job_version integer NOT NULL CHECK (job_version > 0),
  cron_expression varchar(255) NOT NULL,
  timezone varchar(100) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamp NULL,
  next_run_at timestamp NULL,
  locked_by varchar(150) NULL,
  locked_at timestamp NULL,
  lease_expires_at timestamp NULL,
  created_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  updated_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CONSTRAINT jobs_job_schedule_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7)
);

CREATE INDEX IF NOT EXISTS jobs_job_schedule_due_idx
  ON "jobs"."job_schedule" (enabled, next_run_at)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS jobs_job_schedule_lease_idx
  ON "jobs"."job_schedule" (lease_expires_at)
  WHERE locked_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS "jobs"."worker_service" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  role_name name NOT NULL UNIQUE,
  target_service varchar(50) NOT NULL UNIQUE,
  created_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CONSTRAINT jobs_worker_service_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7)
);

INSERT INTO "jobs"."worker_service" (role_name, target_service)
VALUES
  ('project_auth_runtime', 'auth'),
  ('project_access_runtime', 'access'),
  ('project_user_runtime', 'user'),
  ('project_jobs_runtime', 'jobs')
ON CONFLICT (role_name) DO UPDATE
SET target_service = EXCLUDED.target_service;

CREATE OR REPLACE FUNCTION "jobs".assert_enqueue_source(
  p_source_service varchar
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, jobs
AS $$
DECLARE
  mapped_service varchar(50);
BEGIN
  IF session_user IN ('postgres', 'project_migrator') THEN
    RETURN;
  END IF;

  SELECT target_service INTO mapped_service
  FROM "jobs"."worker_service"
  WHERE role_name = session_user::name;

  IF mapped_service IS DISTINCT FROM p_source_service THEN
    RAISE EXCEPTION 'database role % cannot enqueue source service %',
      session_user, p_source_service
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "jobs".assert_worker_target(
  p_target_service varchar
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, jobs
AS $$
DECLARE
  mapped_service varchar(50);
BEGIN
  IF session_user IN ('postgres', 'project_migrator') THEN
    RETURN;
  END IF;

  SELECT target_service INTO mapped_service
  FROM "jobs"."worker_service"
  WHERE role_name = session_user::name;

  IF mapped_service IS DISTINCT FROM p_target_service THEN
    RAISE EXCEPTION 'database role % cannot process target service %',
      session_user, p_target_service
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "jobs".enqueue_job(
  p_type varchar,
  p_version integer,
  p_payload jsonb,
  p_source_service varchar,
  p_target_service varchar,
  p_idempotency_key varchar,
  p_correlation_id varchar DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL,
  p_priority integer DEFAULT 0,
  p_run_at timestamp DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  p_max_attempts integer DEFAULT 5,
  p_schedule_code varchar DEFAULT NULL,
  p_retry_of_job_id uuid DEFAULT NULL
) RETURNS "jobs"."job"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, jobs
AS $$
DECLARE
  result "jobs"."job";
BEGIN
  PERFORM "jobs".assert_enqueue_source(p_source_service);

  INSERT INTO "jobs"."job" (
    type, version, payload, source_service, target_service,
    idempotency_key, correlation_id, actor_user_id, priority, run_at,
    max_attempts, schedule_code, retry_of_job_id
  ) VALUES (
    p_type, p_version, p_payload, p_source_service, p_target_service,
    p_idempotency_key, p_correlation_id, p_actor_user_id, p_priority, p_run_at,
    p_max_attempts, p_schedule_code, p_retry_of_job_id
  )
  ON CONFLICT (source_service, type, idempotency_key) DO NOTHING
  RETURNING * INTO result;

  IF result.id IS NULL THEN
    SELECT * INTO result
    FROM "jobs"."job"
    WHERE source_service = p_source_service
      AND type = p_type
      AND idempotency_key = p_idempotency_key;
  END IF;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION "jobs".claim_jobs(
  p_worker_id varchar,
  p_target_service varchar,
  p_limit integer DEFAULT 1,
  p_lease_ms integer DEFAULT 60000
) RETURNS SETOF "jobs"."job"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, jobs
AS $$
BEGIN
  PERFORM "jobs".assert_worker_target(p_target_service);

  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM "jobs"."job"
    WHERE target_service = p_target_service
      AND status IN ('queued', 'retry_wait')
      AND run_at <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    ORDER BY priority DESC, run_at, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE "jobs"."job" AS job
    SET status = 'running',
        attempt_count = job.attempt_count + 1,
        locked_by = p_worker_id,
        locked_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
        lease_expires_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + (p_lease_ms * interval '1 millisecond'),
        updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    FROM candidates
    WHERE job.id = candidates.id
    RETURNING job.*
  ), attempts AS (
    INSERT INTO "jobs"."job_attempt" (job_id, attempt_number, worker_id)
    SELECT id, attempt_count, p_worker_id FROM claimed
    RETURNING job_id
  )
  SELECT claimed.*
  FROM claimed
  JOIN attempts ON attempts.job_id = claimed.id;
END;
$$;

CREATE OR REPLACE FUNCTION "jobs".heartbeat_job(
  p_job_id uuid,
  p_worker_id varchar,
  p_lease_ms integer DEFAULT 60000
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, jobs
AS $$
DECLARE
  job_target varchar(50);
  updated boolean;
BEGIN
  SELECT target_service INTO job_target
  FROM "jobs"."job"
  WHERE id = p_job_id;

  IF job_target IS NULL THEN
    RETURN false;
  END IF;
  PERFORM "jobs".assert_worker_target(job_target);

  WITH changed AS (
    UPDATE "jobs"."job"
    SET lease_expires_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + (p_lease_ms * interval '1 millisecond'),
        updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    WHERE id = p_job_id AND status = 'running' AND locked_by = p_worker_id
      AND lease_expires_at > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM changed) INTO updated;
  RETURN updated;
END;
$$;

CREATE OR REPLACE FUNCTION "jobs".complete_job(
  p_job_id uuid,
  p_worker_id varchar
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, jobs
AS $$
DECLARE
  job_target varchar(50);
BEGIN
  SELECT target_service INTO job_target
  FROM "jobs"."job"
  WHERE id = p_job_id;

  IF job_target IS NULL THEN
    RETURN false;
  END IF;
  PERFORM "jobs".assert_worker_target(job_target);

  UPDATE "jobs"."job"
  SET status = 'completed', completed_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
      locked_by = NULL, locked_at = NULL, lease_expires_at = NULL,
      updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
  WHERE id = p_job_id AND status = 'running' AND locked_by = p_worker_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE "jobs"."job_attempt"
  SET finished_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), outcome = 'completed',
      duration_ms = EXTRACT(MILLISECONDS FROM ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - started_at))::integer
  WHERE job_id = p_job_id
    AND attempt_number = (SELECT attempt_count FROM "jobs"."job" WHERE id = p_job_id);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION "jobs".fail_job(
  p_job_id uuid,
  p_worker_id varchar,
  p_error_code varchar,
  p_error_message varchar,
  p_retryable boolean,
  p_retry_at timestamp DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, jobs
AS $$
DECLARE
  job_target varchar(50);
  next_status varchar(20);
BEGIN
  SELECT target_service INTO job_target
  FROM "jobs"."job"
  WHERE id = p_job_id;

  IF job_target IS NULL THEN
    RETURN false;
  END IF;
  PERFORM "jobs".assert_worker_target(job_target);

  UPDATE "jobs"."job"
  SET status = CASE WHEN p_retryable AND attempt_count < max_attempts THEN 'retry_wait' ELSE 'failed' END,
      run_at = CASE WHEN p_retryable AND attempt_count < max_attempts THEN COALESCE(p_retry_at, run_at) ELSE run_at END,
      failed_at = CASE WHEN p_retryable AND attempt_count < max_attempts THEN NULL ELSE (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') END,
      last_error_code = left(p_error_code, 100),
      last_error_message = left(p_error_message, 1000),
      locked_by = NULL, locked_at = NULL, lease_expires_at = NULL,
      updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
  WHERE id = p_job_id AND status = 'running' AND locked_by = p_worker_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT status INTO next_status FROM "jobs"."job" WHERE id = p_job_id;
  UPDATE "jobs"."job_attempt"
  SET finished_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
      outcome = CASE WHEN next_status = 'retry_wait' THEN 'retry' ELSE 'failed' END,
      duration_ms = EXTRACT(MILLISECONDS FROM ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - started_at))::integer,
      error_code = left(p_error_code, 100),
      error_message = left(p_error_message, 1000)
  WHERE job_id = p_job_id
    AND attempt_number = (SELECT attempt_count FROM "jobs"."job" WHERE id = p_job_id);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION "jobs".reap_expired_jobs(
  p_now timestamp DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, jobs
AS $$
DECLARE
  recovered integer;
BEGIN
  PERFORM "jobs".assert_worker_target('jobs');

  WITH expired AS (
    UPDATE "jobs"."job"
    SET status = CASE WHEN attempt_count < max_attempts THEN 'retry_wait' ELSE 'failed' END,
        run_at = CASE WHEN attempt_count < max_attempts THEN p_now ELSE run_at END,
        failed_at = CASE WHEN attempt_count < max_attempts THEN NULL ELSE p_now END,
        last_error_code = 'lease_expired',
        last_error_message = 'worker lease expired',
        locked_by = NULL, locked_at = NULL, lease_expires_at = NULL,
        updated_at = p_now
    WHERE status = 'running' AND lease_expires_at < p_now
    RETURNING id, attempt_count, status
  )
  UPDATE "jobs"."job_attempt" AS attempt
  SET finished_at = p_now,
      outcome = CASE WHEN expired.status = 'retry_wait' THEN 'abandoned' ELSE 'failed' END,
      error_code = 'lease_expired', error_message = 'worker lease expired'
  FROM expired
  WHERE attempt.job_id = expired.id AND attempt.attempt_number = expired.attempt_count;

  GET DIAGNOSTICS recovered = ROW_COUNT;
  RETURN recovered;
END;
$$;

REVOKE ALL ON TABLE "jobs"."job", "jobs"."job_attempt", "jobs"."job_schedule", "jobs"."worker_service" FROM PUBLIC;
REVOKE ALL ON FUNCTION "jobs".enqueue_job(varchar, integer, jsonb, varchar, varchar, varchar, varchar, uuid, integer, timestamp, integer, varchar, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "jobs".claim_jobs(varchar, varchar, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "jobs".heartbeat_job(uuid, varchar, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "jobs".complete_job(uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION "jobs".fail_job(uuid, varchar, varchar, varchar, boolean, timestamp) FROM PUBLIC;
REVOKE ALL ON FUNCTION "jobs".reap_expired_jobs(timestamp) FROM PUBLIC;

DO $$
DECLARE
  role_name name;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'project_auth_runtime'::name,
    'project_access_runtime'::name,
    'project_user_runtime'::name,
    'project_jobs_runtime'::name
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA "jobs" TO %I', role_name);
      EXECUTE format('GRANT EXECUTE ON FUNCTION "jobs".enqueue_job(varchar, integer, jsonb, varchar, varchar, varchar, varchar, uuid, integer, timestamp, integer, varchar, uuid) TO %I', role_name);
      EXECUTE format('GRANT EXECUTE ON FUNCTION "jobs".claim_jobs(varchar, varchar, integer, integer) TO %I', role_name);
      EXECUTE format('GRANT EXECUTE ON FUNCTION "jobs".heartbeat_job(uuid, varchar, integer) TO %I', role_name);
      EXECUTE format('GRANT EXECUTE ON FUNCTION "jobs".complete_job(uuid, varchar) TO %I', role_name);
      EXECUTE format('GRANT EXECUTE ON FUNCTION "jobs".fail_job(uuid, varchar, varchar, varchar, boolean, timestamp) TO %I', role_name);
      EXECUTE format('GRANT EXECUTE ON FUNCTION "jobs".reap_expired_jobs(timestamp) TO %I', role_name);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_jobs_runtime') THEN
    GRANT SELECT ON "jobs"."job", "jobs"."job_attempt", "jobs"."job_schedule" TO "project_jobs_runtime";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_migrator') THEN
    GRANT ALL ON SCHEMA "jobs" TO "project_migrator";
    GRANT ALL ON "jobs"."job", "jobs"."job_attempt", "jobs"."job_schedule", "jobs"."worker_service" TO "project_migrator";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_jobs_runtime') THEN
      ALTER DEFAULT PRIVILEGES FOR ROLE "project_migrator" IN SCHEMA "jobs"
        GRANT SELECT ON TABLES TO "project_jobs_runtime";
    END IF;
  END IF;
END
$$;
