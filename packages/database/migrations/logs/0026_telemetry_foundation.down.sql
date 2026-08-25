DROP SCHEMA IF EXISTS "telemetry" CASCADE;

ALTER TABLE "logs"."logging"
  DROP COLUMN IF EXISTS runtime_trace_id,
  DROP COLUMN IF EXISTS runtime_span_id;
ALTER TABLE "logs"."audit_trails"
  DROP COLUMN IF EXISTS runtime_trace_id,
  DROP COLUMN IF EXISTS runtime_span_id;
ALTER TABLE "logs"."access_logs"
  DROP COLUMN IF EXISTS runtime_trace_id,
  DROP COLUMN IF EXISTS runtime_span_id;
