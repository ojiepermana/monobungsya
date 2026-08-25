DROP INDEX IF EXISTS "telemetry".telemetry_alert_states_service_cursor_idx;

ALTER TABLE "telemetry"."alert_rules"
  DROP COLUMN IF EXISTS minimum_operations,
  DROP COLUMN IF EXISTS resource_name;

ALTER TABLE "telemetry"."alert_states"
  DROP COLUMN IF EXISTS resource_name,
  DROP COLUMN IF EXISTS resource_kind,
  DROP COLUMN IF EXISTS service_name;
