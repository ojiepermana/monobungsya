REVOKE SELECT, INSERT, UPDATE ON "telemetry"."alert_rules" FROM "project_jobs_runtime";
REVOKE SELECT ON "telemetry"."alert_rules" FROM "project_logs_writer";
DROP TABLE IF EXISTS "telemetry"."alert_rules";
