DROP TABLE IF EXISTS "telemetry"."signal_migration_runs";
DROP TABLE IF EXISTS "telemetry"."signal_schema_migrations";

DROP FUNCTION IF EXISTS "telemetry".assert_signal_migration_run_transition();
DROP FUNCTION IF EXISTS "telemetry".assert_signal_schema_migration_immutable();
