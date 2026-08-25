REVOKE SELECT, INSERT, UPDATE ON "telemetry"."alert_states" FROM "project_jobs_runtime";
REVOKE SELECT ON "telemetry"."spans", "telemetry"."metric_buckets" FROM "project_jobs_runtime";
REVOKE USAGE ON SCHEMA "telemetry" FROM "project_jobs_runtime";
ALTER TABLE "telemetry"."alert_states"
  DROP COLUMN IF EXISTS consecutive_healthy_windows;
