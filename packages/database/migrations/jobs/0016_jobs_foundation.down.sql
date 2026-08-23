DROP FUNCTION IF EXISTS "jobs".reap_expired_jobs(timestamp);
DROP FUNCTION IF EXISTS "jobs".fail_job(uuid, varchar, varchar, varchar, boolean, timestamp);
DROP FUNCTION IF EXISTS "jobs".complete_job(uuid, varchar);
DROP FUNCTION IF EXISTS "jobs".heartbeat_job(uuid, varchar, integer);
DROP FUNCTION IF EXISTS "jobs".claim_jobs(varchar, varchar, integer, integer);
DROP FUNCTION IF EXISTS "jobs".enqueue_job(varchar, integer, jsonb, varchar, varchar, varchar, varchar, uuid, integer, timestamp, integer, varchar, uuid);
DROP TABLE IF EXISTS "jobs"."job_attempt";
DROP TABLE IF EXISTS "jobs"."job";
DROP SCHEMA IF EXISTS "jobs";
