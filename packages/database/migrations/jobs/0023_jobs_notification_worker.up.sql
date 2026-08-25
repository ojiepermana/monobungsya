INSERT INTO "jobs"."worker_service" (role_name, target_service)
VALUES ('project_notification_runtime', 'notification')
ON CONFLICT (role_name) DO UPDATE SET target_service = EXCLUDED.target_service;

DO $$
DECLARE
  role_name name;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_notification_runtime') THEN
    GRANT USAGE ON SCHEMA "jobs" TO "project_notification_runtime";
    GRANT EXECUTE ON FUNCTION "jobs".enqueue_job(varchar, integer, jsonb, varchar, varchar, varchar, varchar, uuid, integer, timestamp, integer, varchar, uuid) TO "project_notification_runtime";
    GRANT EXECUTE ON FUNCTION "jobs".claim_jobs(varchar, varchar, integer, integer) TO "project_notification_runtime";
    GRANT EXECUTE ON FUNCTION "jobs".heartbeat_job(uuid, varchar, integer) TO "project_notification_runtime";
    GRANT EXECUTE ON FUNCTION "jobs".complete_job(uuid, varchar) TO "project_notification_runtime";
    GRANT EXECUTE ON FUNCTION "jobs".fail_job(uuid, varchar, varchar, varchar, boolean, timestamp) TO "project_notification_runtime";
    GRANT EXECUTE ON FUNCTION "jobs".release_job(uuid, varchar) TO "project_notification_runtime";
  END IF;
END
$$;
