REVOKE EXECUTE ON FUNCTION "jobs".enqueue_job(varchar, integer, jsonb, varchar, varchar, varchar, varchar, uuid, integer, timestamp, integer, varchar, uuid, varchar) FROM "project_jobs_runtime";
DROP FUNCTION IF EXISTS "jobs".enqueue_job(varchar, integer, jsonb, varchar, varchar, varchar, varchar, uuid, integer, timestamp, integer, varchar, uuid, varchar);
ALTER TABLE "jobs"."job" DROP COLUMN IF EXISTS trace_parent;
