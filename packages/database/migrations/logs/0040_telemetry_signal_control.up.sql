CREATE TABLE IF NOT EXISTS "telemetry"."signal_schema_migrations" (
  version bigint PRIMARY KEY,
  name varchar(150) NOT NULL,
  checksum char(64) NOT NULL UNIQUE,
  clickhouse_version varchar(50) NOT NULL,
  execution_ms bigint NOT NULL,
  applied_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
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

CREATE TABLE IF NOT EXISTS "telemetry"."signal_migration_runs" (
  run_id uuid PRIMARY KEY DEFAULT uuidv7(),
  signal_kind varchar(30) NOT NULL,
  schema_version integer NOT NULL,
  source_from timestamp NOT NULL,
  source_to timestamp NOT NULL,
  source_cursor jsonb NULL,
  source_count bigint NOT NULL DEFAULT 0,
  target_count bigint NOT NULL DEFAULT 0,
  sample_modulus integer NOT NULL DEFAULT 1000,
  source_checksum char(64) NULL,
  target_checksum char(64) NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  error_code varchar(100) NULL,
  started_at timestamp NULL,
  updated_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  finished_at timestamp NULL,
  CONSTRAINT telemetry_signal_migration_runs_run_id_uuidv7_check
    CHECK ((get_byte(uuid_send(run_id), 6) >> 4) = 7),
  CONSTRAINT telemetry_signal_migration_runs_signal_kind_check
    CHECK (signal_kind IN ('span', 'metric_bucket', 'application_log', 'access_log')),
  CONSTRAINT telemetry_signal_migration_runs_schema_version_positive_check
    CHECK (schema_version > 0),
  CONSTRAINT telemetry_signal_migration_runs_source_range_daily_check
    CHECK (
      source_from < source_to
      AND date_trunc('day', source_from) = source_from
      AND source_to = source_from + interval '1 day'
    ),
  CONSTRAINT telemetry_signal_migration_runs_source_count_nonnegative_check
    CHECK (source_count >= 0),
  CONSTRAINT telemetry_signal_migration_runs_target_count_nonnegative_check
    CHECK (target_count >= 0),
  CONSTRAINT telemetry_signal_migration_runs_sample_modulus_positive_check
    CHECK (sample_modulus > 0),
  CONSTRAINT telemetry_signal_migration_runs_source_checksum_sha256_check
    CHECK (source_checksum IS NULL OR source_checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT telemetry_signal_migration_runs_target_checksum_sha256_check
    CHECK (target_checksum IS NULL OR target_checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT telemetry_signal_migration_runs_status_check
    CHECK (status IN ('pending', 'running', 'paused', 'succeeded', 'failed')),
  CONSTRAINT telemetry_signal_migration_runs_finished_at_terminal_check
    CHECK (
      (status IN ('pending', 'running', 'paused') AND finished_at IS NULL)
      OR (status IN ('succeeded', 'failed') AND finished_at IS NOT NULL)
    ),
  CONSTRAINT telemetry_signal_migration_runs_succeeded_evidence_check
    CHECK (
      status <> 'succeeded'
      OR (
        source_checksum IS NOT NULL
        AND target_checksum IS NOT NULL
        AND source_count = target_count
        AND source_checksum = target_checksum
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS telemetry_signal_migration_runs_one_active_range_idx
  ON "telemetry"."signal_migration_runs" (
    signal_kind,
    schema_version,
    source_from,
    source_to
  )
  WHERE status IN ('pending', 'running', 'paused');

CREATE INDEX IF NOT EXISTS telemetry_signal_migration_runs_status_updated_idx
  ON "telemetry"."signal_migration_runs" (status, updated_at DESC, run_id);

CREATE OR REPLACE FUNCTION "telemetry".assert_signal_schema_migration_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'telemetry.signal_schema_migrations rows are immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER telemetry_signal_schema_migrations_immutable
  BEFORE UPDATE OR DELETE ON "telemetry"."signal_schema_migrations"
  FOR EACH ROW
  EXECUTE FUNCTION "telemetry".assert_signal_schema_migration_immutable();

CREATE OR REPLACE FUNCTION "telemetry".assert_signal_migration_run_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'succeeded' THEN
      RAISE EXCEPTION 'succeeded telemetry.signal_migration_runs rows are immutable'
        USING ERRCODE = '55000';
    END IF;

    RETURN OLD;
  END IF;

  IF OLD.status = 'succeeded' THEN
    RAISE EXCEPTION 'succeeded telemetry.signal_migration_runs rows are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'failed' THEN
    RAISE EXCEPTION 'failed telemetry.signal_migration_runs rows are terminal'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'pending'
    AND NEW.status NOT IN ('pending', 'running', 'failed') THEN
    RAISE EXCEPTION 'invalid telemetry.signal_migration_runs transition from pending'
      USING ERRCODE = '22023';
  END IF;

  IF OLD.status = 'running'
    AND NEW.status NOT IN ('running', 'paused', 'succeeded', 'failed') THEN
    RAISE EXCEPTION 'invalid telemetry.signal_migration_runs transition from running'
      USING ERRCODE = '22023';
  END IF;

  IF OLD.status = 'paused'
    AND NEW.status NOT IN ('paused', 'running', 'failed') THEN
    RAISE EXCEPTION 'invalid telemetry.signal_migration_runs transition from paused'
      USING ERRCODE = '22023';
  END IF;

  NEW.updated_at := CURRENT_TIMESTAMP AT TIME ZONE 'UTC';
  RETURN NEW;
END;
$$;

CREATE TRIGGER telemetry_signal_migration_runs_transition
  BEFORE UPDATE OR DELETE ON "telemetry"."signal_migration_runs"
  FOR EACH ROW
  EXECUTE FUNCTION "telemetry".assert_signal_migration_run_transition();

REVOKE ALL ON TABLE
  "telemetry"."signal_schema_migrations",
  "telemetry"."signal_migration_runs"
FROM PUBLIC;
REVOKE ALL ON FUNCTION "telemetry".assert_signal_schema_migration_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION "telemetry".assert_signal_migration_run_transition() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_migrator') THEN
    GRANT SELECT, INSERT
      ON "telemetry"."signal_schema_migrations"
      TO "project_migrator";
    GRANT SELECT, INSERT, UPDATE
      ON "telemetry"."signal_migration_runs"
      TO "project_migrator";
    GRANT EXECUTE
      ON FUNCTION "telemetry".assert_signal_schema_migration_immutable()
      TO "project_migrator";
    GRANT EXECUTE
      ON FUNCTION "telemetry".assert_signal_migration_run_transition()
      TO "project_migrator";
  END IF;
END
$$;
