CREATE TABLE IF NOT EXISTS "telemetry"."alert_rules" (
  rule_id varchar(120) NOT NULL,
  rule_version varchar(50) NOT NULL,
  title varchar(255) NOT NULL,
  severity varchar(20) NOT NULL,
  metric varchar(100) NOT NULL,
  threshold double precision NOT NULL,
  window_seconds integer NOT NULL,
  required_windows integer NOT NULL,
  manifest_checksum char(64) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  PRIMARY KEY (rule_id, rule_version),
  CONSTRAINT telemetry_alert_rules_severity_check CHECK (severity IN ('warning', 'critical'))
);

GRANT SELECT ON "telemetry"."alert_rules" TO "project_logs_writer";
GRANT SELECT, INSERT, UPDATE ON "telemetry"."alert_rules" TO "project_jobs_runtime";
