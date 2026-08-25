DROP FUNCTION IF EXISTS "telemetry".cleanup_expired(interval, interval, interval);
REVOKE UPDATE ON "telemetry"."metric_buckets" FROM "project_telemetry_writer";
