ALTER TABLE "telemetry"."alert_states"
  ADD COLUMN IF NOT EXISTS service_name varchar(50) NOT NULL DEFAULT 'runtime',
  ADD COLUMN IF NOT EXISTS resource_kind varchar(40) NOT NULL DEFAULT 'business.operation',
  ADD COLUMN IF NOT EXISTS resource_name varchar(150) NOT NULL DEFAULT 'runtime';

ALTER TABLE "telemetry"."alert_rules"
  ADD COLUMN IF NOT EXISTS resource_name varchar(150) NULL,
  ADD COLUMN IF NOT EXISTS minimum_operations integer NULL;

CREATE INDEX IF NOT EXISTS telemetry_alert_states_service_cursor_idx
  ON "telemetry"."alert_states" (service_name, last_evaluated_at DESC, rule_id, series_fingerprint);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_logs_writer') THEN
    EXECUTE 'GRANT SELECT ON "telemetry"."alert_states", "telemetry"."alert_rules" TO "project_logs_writer"';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_jobs_runtime') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON "telemetry"."alert_rules" TO "project_jobs_runtime"';
  END IF;
END
$$;
