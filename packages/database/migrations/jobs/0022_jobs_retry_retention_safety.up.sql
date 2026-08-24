ALTER TABLE "jobs"."job_retry_request"
  DROP CONSTRAINT IF EXISTS "job_retry_request_source_job_id_fkey",
  DROP CONSTRAINT IF EXISTS "job_retry_request_new_job_id_fkey";

ALTER TABLE "jobs"."job_retry_request"
  ADD CONSTRAINT "job_retry_request_source_job_id_fkey"
    FOREIGN KEY (source_job_id) REFERENCES "jobs"."job"(id) ON DELETE CASCADE,
  ADD CONSTRAINT "job_retry_request_new_job_id_fkey"
    FOREIGN KEY (new_job_id) REFERENCES "jobs"."job"(id) ON DELETE CASCADE;

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

  derived_key := left(source_job.idempotency_key, 200)
    || ':manual:' || p_idempotency_key::varchar;
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
    p_source_job_id, p_idempotency_key, result.id, p_actor_user_id,
    left(trim(p_reason), 1000)
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
