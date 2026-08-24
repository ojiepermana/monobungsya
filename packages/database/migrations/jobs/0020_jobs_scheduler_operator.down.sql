DROP FUNCTION IF EXISTS "jobs".manual_retry_job(uuid, uuid, varchar, uuid);
DROP FUNCTION IF EXISTS "jobs".cleanup_terminal_jobs(timestamp, integer);
DROP FUNCTION IF EXISTS "jobs".complete_job_schedule(varchar, varchar, timestamp, timestamp);
DROP FUNCTION IF EXISTS "jobs".claim_due_schedules(varchar, timestamp, integer, integer);
DROP FUNCTION IF EXISTS "jobs".disable_missing_job_schedules(jsonb);
DROP FUNCTION IF EXISTS "jobs".sync_job_schedule(varchar, varchar, integer, varchar, varchar, boolean, timestamp);
DROP FUNCTION IF EXISTS "jobs".assert_jobs_runtime();
DROP TABLE IF EXISTS "jobs"."job_retry_request";
