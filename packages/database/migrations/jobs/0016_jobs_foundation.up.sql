CREATE SCHEMA IF NOT EXISTS "jobs";

CREATE TABLE "jobs"."job" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  type varchar(100) NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  payload jsonb NOT NULL CHECK (pg_column_size(payload) <= 65536),
  source_service varchar(50) NOT NULL,
  target_service varchar(50) NOT NULL,
  idempotency_key varchar(255) NOT NULL,
  correlation_id varchar(100) NULL,
  actor_user_id uuid NULL,
  status varchar(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'retry_wait', 'completed', 'failed')),
  priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN -100 AND 100),
  run_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 100),
  locked_by varchar(150) NULL,
  locked_at timestamp NULL,
  lease_expires_at timestamp NULL,
  completed_at timestamp NULL,
  failed_at timestamp NULL,
  last_error_code varchar(100) NULL,
  last_error_message varchar(1000) NULL,
  schedule_code varchar(150) NULL,
  retry_of_job_id uuid NULL,
  created_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  updated_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CONSTRAINT jobs_job_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7),
  CONSTRAINT jobs_job_idempotency_key_unique
    UNIQUE (source_service, type, idempotency_key)
);

CREATE INDEX jobs_job_claim_idx
  ON "jobs"."job" (target_service, status, priority DESC, run_at, created_at)
  WHERE status IN ('queued', 'retry_wait');
CREATE INDEX jobs_job_lease_idx
  ON "jobs"."job" (lease_expires_at)
  WHERE status = 'running';
CREATE INDEX jobs_job_schedule_idx
  ON "jobs"."job" (schedule_code, run_at);

CREATE TABLE "jobs"."job_attempt" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  job_id uuid NOT NULL REFERENCES "jobs"."job"(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  worker_id varchar(150) NOT NULL,
  started_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  finished_at timestamp NULL,
  outcome varchar(20) NULL CHECK (outcome IN ('completed', 'retry', 'failed', 'abandoned')),
  duration_ms integer NULL CHECK (duration_ms >= 0),
  error_code varchar(100) NULL,
  error_message varchar(1000) NULL,
  CONSTRAINT jobs_job_attempt_number_unique UNIQUE (job_id, attempt_number),
  CONSTRAINT jobs_job_attempt_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7)
);

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

CREATE OR REPLACE FUNCTION "jobs".claim_jobs(
  p_worker_id varchar,
  p_target_service varchar,
  p_limit integer DEFAULT 1,
  p_lease_ms integer DEFAULT 60000
) RETURNS SETOF "jobs"."job"
LANGUAGE sql
AS $$
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
  SELECT claimed.* FROM claimed
  JOIN attempts ON attempts.job_id = claimed.id;
$$;

CREATE OR REPLACE FUNCTION "jobs".heartbeat_job(
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

CREATE OR REPLACE FUNCTION "jobs".complete_job(
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
  WHERE job_id = p_job_id AND attempt_number = (SELECT attempt_count FROM "jobs"."job" WHERE id = p_job_id);
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
  WHERE job_id = p_job_id AND attempt_number = (SELECT attempt_count FROM "jobs"."job" WHERE id = p_job_id);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION "jobs".reap_expired_jobs(
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
        last_error_code = 'lease_expired',
        last_error_message = 'worker lease expired',
        locked_by = NULL, locked_at = NULL, lease_expires_at = NULL,
        updated_at = p_now
    WHERE status = 'running' AND lease_expires_at < p_now
    RETURNING id, attempt_count, status
  )
  UPDATE "jobs"."job_attempt" AS attempt
  SET finished_at = p_now, outcome = CASE WHEN expired.status = 'retry_wait' THEN 'abandoned' ELSE 'failed' END,
      error_code = 'lease_expired', error_message = 'worker lease expired'
  FROM expired
  WHERE attempt.job_id = expired.id AND attempt.attempt_number = expired.attempt_count;

  GET DIAGNOSTICS recovered = ROW_COUNT;
  RETURN recovered;
END;
$$;
