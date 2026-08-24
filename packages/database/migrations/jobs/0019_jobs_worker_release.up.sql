CREATE OR REPLACE FUNCTION "jobs".release_job(
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
  SET status = CASE WHEN attempt_count < max_attempts THEN 'retry_wait' ELSE 'failed' END,
      run_at = CASE WHEN attempt_count < max_attempts THEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') ELSE run_at END,
      failed_at = CASE WHEN attempt_count < max_attempts THEN NULL ELSE (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') END,
      last_error_code = 'worker_shutdown',
      last_error_message = 'worker released job during shutdown',
      locked_by = NULL,
      locked_at = NULL,
      lease_expires_at = NULL,
      updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
  WHERE id = p_job_id AND status = 'running' AND locked_by = p_worker_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE "jobs"."job_attempt"
  SET finished_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
      outcome = CASE WHEN (SELECT status FROM "jobs"."job" WHERE id = p_job_id) = 'retry_wait' THEN 'abandoned' ELSE 'failed' END,
      error_code = 'worker_shutdown',
      error_message = 'worker released job during shutdown',
      duration_ms = EXTRACT(MILLISECONDS FROM ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - started_at))::integer
  WHERE job_id = p_job_id
    AND attempt_number = (SELECT attempt_count FROM "jobs"."job" WHERE id = p_job_id);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION "jobs".release_job(uuid, varchar) FROM PUBLIC;

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
      EXECUTE format('GRANT EXECUTE ON FUNCTION "jobs".release_job(uuid, varchar) TO %I', role_name);
    END IF;
  END LOOP;
END
$$;
