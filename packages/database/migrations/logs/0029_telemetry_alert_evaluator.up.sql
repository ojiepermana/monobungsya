ALTER TABLE "telemetry"."alert_states"
  ADD COLUMN IF NOT EXISTS consecutive_healthy_windows integer NOT NULL DEFAULT 0;

GRANT USAGE ON SCHEMA "telemetry" TO "project_jobs_runtime";
GRANT SELECT ON "telemetry"."spans", "telemetry"."metric_buckets" TO "project_jobs_runtime";
GRANT SELECT, INSERT, UPDATE ON "telemetry"."alert_states" TO "project_jobs_runtime";
