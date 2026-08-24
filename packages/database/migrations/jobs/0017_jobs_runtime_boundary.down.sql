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
      EXECUTE format('REVOKE USAGE ON SCHEMA "jobs" FROM %I', role_name);
    END IF;
  END LOOP;
END
$$;

DROP FUNCTION IF EXISTS "jobs".assert_worker_target(varchar);
DROP FUNCTION IF EXISTS "jobs".assert_enqueue_source(varchar);

DROP FUNCTION IF EXISTS "jobs".reap_expired_jobs(timestamp);
DROP FUNCTION IF EXISTS "jobs".fail_job(uuid, varchar, varchar, varchar, boolean, timestamp);
DROP FUNCTION IF EXISTS "jobs".complete_job(uuid, varchar);
DROP FUNCTION IF EXISTS "jobs".heartbeat_job(uuid, varchar, integer);
DROP FUNCTION IF EXISTS "jobs".claim_jobs(varchar, varchar, integer, integer);
DROP FUNCTION IF EXISTS "jobs".enqueue_job(varchar, integer, jsonb, varchar, varchar, varchar, varchar, uuid, integer, timestamp, integer, varchar, uuid);

CREATE FUNCTION "jobs".enqueue_job(
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
AS $$
DECLARE
  result "jobs"."job";
BEGIN
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

CREATE FUNCTION "jobs".claim_jobs(
  p_worker_id varchar,
  p_target_service varchar,
  p_limit integer DEFAULT 1,
  p_lease_ms integer DEFAULT 60000
) RETURNS SETOF "jobs"."job"
LANGUAGE sql
AS $$
  WITH candidates AS (
    SELECT id FROM "jobs"."job"
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
  SELECT claimed.* FROM claimed JOIN attempts ON attempts.job_id = claimed.id;
$$;

CREATE FUNCTION "jobs".heartbeat_job(
  p_job_id uuid,
  p_worker_id varchar,
  p_lease_ms integer DEFAULT 60000
) RETURNS boolean
LANGUAGE sql
AS $$
  WITH updated AS (
    UPDATE "jobs"."job"
    SET lease_expires_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + (p_lease_ms * interval '1 millisecond'),
        updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    WHERE id = p_job_id AND status = 'running' AND locked_by = p_worker_id
      AND lease_expires_at > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM updated);
$$;

CREATE FUNCTION "jobs".complete_job(
  p_job_id uuid,
  p_worker_id varchar
) RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "jobs"."job"
  SET status = 'completed', completed_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
      locked_by = NULL, locked_at = NULL, lease_expires_at = NULL,
      updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
  WHERE id = p_job_id AND status = 'running' AND locked_by = p_worker_id;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE "jobs"."job_attempt"
  SET finished_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), outcome = 'completed',
      duration_ms = EXTRACT(MILLISECONDS FROM ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - started_at))::integer
  WHERE job_id = p_job_id
    AND attempt_number = (SELECT attempt_count FROM "jobs"."job" WHERE id = p_job_id);
  RETURN true;
END;
$$;

CREATE FUNCTION "jobs".fail_job(
  p_job_id uuid,
  p_worker_id varchar,
  p_error_code varchar,
  p_error_message varchar,
  p_retryable boolean,
  p_retry_at timestamp DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  next_status varchar(20);
BEGIN
  UPDATE "jobs"."job"
  SET status = CASE WHEN p_retryable AND attempt_count < max_attempts THEN 'retry_wait' ELSE 'failed' END,
      run_at = CASE WHEN p_retryable AND attempt_count < max_attempts THEN COALESCE(p_retry_at, run_at) ELSE run_at END,
      failed_at = CASE WHEN p_retryable AND attempt_count < max_attempts THEN NULL ELSE (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') END,
      last_error_code = p_error_code, last_error_message = p_error_message,
      locked_by = NULL, locked_at = NULL, lease_expires_at = NULL,
      updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
  WHERE id = p_job_id AND status = 'running' AND locked_by = p_worker_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT status INTO next_status FROM "jobs"."job" WHERE id = p_job_id;
  UPDATE "jobs"."job_attempt"
  SET finished_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
      outcome = CASE WHEN next_status = 'retry_wait' THEN 'retry' ELSE 'failed' END,
      duration_ms = EXTRACT(MILLISECONDS FROM ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - started_at))::integer,
      error_code = p_error_code, error_message = p_error_message
  WHERE job_id = p_job_id
    AND attempt_number = (SELECT attempt_count FROM "jobs"."job" WHERE id = p_job_id);
  RETURN true;
END;
$$;

CREATE FUNCTION "jobs".reap_expired_jobs(
  p_now timestamp DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  recovered integer;
BEGIN
  WITH expired AS (
    UPDATE "jobs"."job"
    SET status = CASE WHEN attempt_count < max_attempts THEN 'retry_wait' ELSE 'failed' END,
        run_at = CASE WHEN attempt_count < max_attempts THEN p_now ELSE run_at END,
        failed_at = CASE WHEN attempt_count < max_attempts THEN NULL ELSE p_now END,
        last_error_code = 'lease_expired', last_error_message = 'worker lease expired',
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

DROP TABLE IF EXISTS "jobs"."worker_service";
DROP TABLE IF EXISTS "jobs"."job_schedule";
