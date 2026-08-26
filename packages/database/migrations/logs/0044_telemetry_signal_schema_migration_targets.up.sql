ALTER TABLE "telemetry"."signal_schema_migrations"
  RENAME TO "signal_schema_migration_history_legacy";

DROP TRIGGER IF EXISTS telemetry_signal_schema_migrations_immutable
  ON "telemetry"."signal_schema_migration_history_legacy";

CREATE TRIGGER telemetry_signal_schema_migration_history_legacy_immutable
  BEFORE INSERT OR UPDATE OR DELETE
  ON "telemetry"."signal_schema_migration_history_legacy"
  FOR EACH ROW
  EXECUTE FUNCTION "telemetry".assert_signal_schema_migration_immutable();

CREATE TABLE "telemetry"."signal_schema_migrations" (
  target_id uuid NOT NULL,
  version bigint NOT NULL,
  name varchar(150) NOT NULL,
  checksum char(64) NOT NULL,
  clickhouse_version varchar(50) NOT NULL,
  execution_ms bigint NOT NULL,
  applied_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CONSTRAINT telemetry_signal_schema_migrations_target_version_pkey
    PRIMARY KEY (target_id, version),
  CONSTRAINT telemetry_signal_schema_migrations_target_checksum_unique
    UNIQUE (target_id, checksum),
  CONSTRAINT telemetry_signal_schema_migrations_target_not_nil_check
    CHECK (target_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  CONSTRAINT telemetry_signal_schema_migrations_version_positive_check
    CHECK (version > 0),
  CONSTRAINT telemetry_signal_schema_migrations_name_nonempty_check
    CHECK (length(btrim(name)) > 0),
  CONSTRAINT telemetry_signal_schema_migrations_checksum_sha256_check
    CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT telemetry_signal_schema_migrations_ch_version_nonempty_check
    CHECK (length(btrim(clickhouse_version)) > 0),
  CONSTRAINT telemetry_signal_schema_migrations_execution_nonnegative_check
    CHECK (execution_ms >= 0)
);

CREATE TRIGGER telemetry_signal_schema_migrations_immutable
  BEFORE UPDATE OR DELETE ON "telemetry"."signal_schema_migrations"
  FOR EACH ROW
  EXECUTE FUNCTION "telemetry".assert_signal_schema_migration_immutable();

COMMENT ON TABLE "telemetry"."signal_schema_migration_history_legacy" IS
  'Immutable pre target scoped ClickHouse migration audit history. It is never used to skip a target migration.';
COMMENT ON TABLE "telemetry"."signal_schema_migrations" IS
  'Immutable ClickHouse migration history scoped by serverUUID() target identity.';

REVOKE ALL ON TABLE
  "telemetry"."signal_schema_migration_history_legacy",
  "telemetry"."signal_schema_migrations"
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_migrator') THEN
    REVOKE INSERT, UPDATE, DELETE
      ON "telemetry"."signal_schema_migration_history_legacy"
      FROM "project_migrator";
    GRANT SELECT
      ON "telemetry"."signal_schema_migration_history_legacy"
      TO "project_migrator";
    GRANT SELECT, INSERT
      ON "telemetry"."signal_schema_migrations"
      TO "project_migrator";
    GRANT EXECUTE
      ON FUNCTION "telemetry".assert_signal_schema_migration_immutable()
      TO "project_migrator";
  END IF;
END
$$;
