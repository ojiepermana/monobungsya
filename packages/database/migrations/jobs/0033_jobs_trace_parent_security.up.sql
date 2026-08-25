CREATE OR REPLACE FUNCTION "jobs".enqueue_job(
  p_type varchar,
  p_version integer,
  p_payload jsonb,
  p_source_service varchar,
  p_target_service varchar,
  p_idempotency_key varchar,
  p_correlation_id varchar,
  p_actor_user_id uuid,
  p_priority integer,
  p_run_at timestamp,
  p_max_attempts integer,
  p_schedule_code varchar,
  p_retry_of_job_id uuid,
  p_trace_parent varchar
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
    max_attempts, schedule_code, retry_of_job_id, trace_parent
  ) VALUES (
    p_type, p_version, p_payload, p_source_service, p_target_service,
    p_idempotency_key, p_correlation_id, p_actor_user_id, p_priority, p_run_at,
    p_max_attempts, p_schedule_code, p_retry_of_job_id, p_trace_parent
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

REVOKE ALL ON FUNCTION "jobs".enqueue_job(
  varchar, integer, jsonb, varchar, varchar, varchar, varchar, uuid,
  integer, timestamp, integer, varchar, uuid, varchar
) FROM PUBLIC;

DO $$
DECLARE
  role_name name;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'project_auth_runtime'::name,
    'project_access_runtime'::name,
    'project_user_runtime'::name,
    'project_jobs_runtime'::name,
    'project_notification_runtime'::name
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION "jobs".enqueue_job(varchar, integer, jsonb, varchar, varchar, varchar, varchar, uuid, integer, timestamp, integer, varchar, uuid, varchar) TO %I',
        role_name
      );
    END IF;
  END LOOP;
END
$$;
