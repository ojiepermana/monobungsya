SELECT pg_advisory_xact_lock(
  hashtext('project:observability:clickhouse-migrations:v1')
);
LOCK TABLE "telemetry"."signal_schema_migrations" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "telemetry"."signal_schema_migrations"
  ) THEN
    RAISE EXCEPTION 'cannot roll back target scoped ClickHouse migration history after it has rows'
      USING ERRCODE = '55000';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS telemetry_signal_schema_migrations_immutable
  ON "telemetry"."signal_schema_migrations";
DROP TABLE "telemetry"."signal_schema_migrations";

DROP TRIGGER IF EXISTS telemetry_signal_schema_migration_history_legacy_immutable
  ON "telemetry"."signal_schema_migration_history_legacy";
ALTER TABLE "telemetry"."signal_schema_migration_history_legacy"
  RENAME TO "signal_schema_migrations";

CREATE TRIGGER telemetry_signal_schema_migrations_immutable
  BEFORE UPDATE OR DELETE ON "telemetry"."signal_schema_migrations"
  FOR EACH ROW
  EXECUTE FUNCTION "telemetry".assert_signal_schema_migration_immutable();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_migrator') THEN
    GRANT SELECT, INSERT
      ON "telemetry"."signal_schema_migrations"
      TO "project_migrator";
  END IF;
END
$$;
