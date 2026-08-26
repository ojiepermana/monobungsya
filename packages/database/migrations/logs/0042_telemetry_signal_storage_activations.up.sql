CREATE TABLE IF NOT EXISTS "telemetry"."signal_storage_activations" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  activation_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  activation_kind varchar(20) NOT NULL,
  from_write_mode varchar(20) NOT NULL,
  from_read_mode varchar(20) NOT NULL,
  to_write_mode varchar(20) NOT NULL,
  to_read_mode varchar(20) NOT NULL,
  report_id uuid NULL REFERENCES "telemetry"."signal_promotion_reports" (id),
  activated_by varchar(200) NOT NULL,
  activated_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CONSTRAINT telemetry_signal_storage_activations_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7),
  CONSTRAINT telemetry_signal_storage_activations_kind_check
    CHECK (activation_kind IN ('initial', 'forward', 'rollback')),
  CONSTRAINT telemetry_signal_storage_activations_from_write_mode_check
    CHECK (from_write_mode IN ('postgres', 'dual', 'clickhouse')),
  CONSTRAINT telemetry_signal_storage_activations_from_read_mode_check
    CHECK (from_read_mode IN ('postgres', 'clickhouse')),
  CONSTRAINT telemetry_signal_storage_activations_to_write_mode_check
    CHECK (to_write_mode IN ('postgres', 'dual', 'clickhouse')),
  CONSTRAINT telemetry_signal_storage_activations_to_read_mode_check
    CHECK (to_read_mode IN ('postgres', 'clickhouse')),
  CONSTRAINT telemetry_signal_storage_activations_transition_check
    CHECK (
      (
        activation_kind = 'initial'
        AND from_write_mode = 'postgres'
        AND from_read_mode = 'postgres'
        AND to_write_mode = 'postgres'
        AND to_read_mode = 'postgres'
        AND report_id IS NULL
      )
      OR (
        activation_kind = 'forward'
        AND (
          (
            from_write_mode = 'postgres'
            AND from_read_mode = 'postgres'
            AND to_write_mode = 'dual'
            AND to_read_mode = 'postgres'
            AND report_id IS NULL
          )
          OR (
            from_write_mode = 'dual'
            AND from_read_mode = 'postgres'
            AND to_write_mode = 'dual'
            AND to_read_mode = 'clickhouse'
            AND report_id IS NOT NULL
          )
          OR (
            from_write_mode = 'dual'
            AND from_read_mode = 'clickhouse'
            AND to_write_mode = 'clickhouse'
            AND to_read_mode = 'clickhouse'
            AND report_id IS NOT NULL
          )
        )
      )
      OR (
        activation_kind = 'rollback'
        AND report_id IS NULL
        AND to_write_mode = 'dual'
        AND to_read_mode = 'postgres'
        AND (
          (from_write_mode = 'dual' AND from_read_mode = 'clickhouse')
          OR (from_write_mode = 'clickhouse' AND from_read_mode = 'clickhouse')
        )
      )
    ),
  CONSTRAINT telemetry_signal_storage_activations_activated_by_nonempty_check
    CHECK (length(btrim(activated_by)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS telemetry_signal_storage_activations_report_once_idx
  ON "telemetry"."signal_storage_activations" (report_id)
  WHERE report_id IS NOT NULL;

INSERT INTO "telemetry"."signal_storage_activations" (
  activation_kind,
  from_write_mode,
  from_read_mode,
  to_write_mode,
  to_read_mode,
  report_id,
  activated_by
)
SELECT
  'initial',
  'postgres',
  'postgres',
  'postgres',
  'postgres',
  NULL,
  'migration'
WHERE NOT EXISTS (
  SELECT 1 FROM "telemetry"."signal_storage_activations"
);

CREATE OR REPLACE FUNCTION "telemetry".assert_signal_storage_activation_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'telemetry.signal_storage_activations rows are immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION "telemetry".assert_signal_storage_activation_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_write_mode varchar(20);
  current_read_mode varchar(20);
  report_from_write_mode varchar(20);
  report_from_read_mode varchar(20);
  report_to_write_mode varchar(20);
  report_to_read_mode varchar(20);
  report_allowed boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('telemetry.signal_storage_activation', 0)
  );

  IF NEW.activation_kind = 'initial' THEN
    IF EXISTS (SELECT 1 FROM "telemetry"."signal_storage_activations") THEN
      RAISE EXCEPTION 'telemetry.signal_storage_activations already has an initial state'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  SELECT to_write_mode, to_read_mode
  INTO current_write_mode, current_read_mode
  FROM "telemetry"."signal_storage_activations"
  ORDER BY activation_sequence DESC
  LIMIT 1;

  IF current_write_mode IS NULL
    OR current_write_mode <> NEW.from_write_mode
    OR current_read_mode <> NEW.from_read_mode THEN
    RAISE EXCEPTION 'telemetry.signal_storage_activations transition does not match current state'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.report_id IS NOT NULL THEN
    SELECT
      from_write_mode,
      from_read_mode,
      to_write_mode,
      to_read_mode,
      (decision ->> 'allowed')::boolean
    INTO
      report_from_write_mode,
      report_from_read_mode,
      report_to_write_mode,
      report_to_read_mode,
      report_allowed
    FROM "telemetry"."signal_promotion_reports"
    WHERE id = NEW.report_id;

    IF report_from_write_mode IS NULL
      OR report_from_write_mode <> NEW.from_write_mode
      OR report_from_read_mode <> NEW.from_read_mode
      OR report_to_write_mode <> NEW.to_write_mode
      OR report_to_read_mode <> NEW.to_read_mode
      OR report_allowed IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'telemetry.signal_storage_activations report does not authorize this transition'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER telemetry_signal_storage_activations_immutable
  BEFORE UPDATE OR DELETE ON "telemetry"."signal_storage_activations"
  FOR EACH ROW
  EXECUTE FUNCTION "telemetry".assert_signal_storage_activation_immutable();

CREATE TRIGGER telemetry_signal_storage_activations_transition
  BEFORE INSERT ON "telemetry"."signal_storage_activations"
  FOR EACH ROW
  EXECUTE FUNCTION "telemetry".assert_signal_storage_activation_transition();

REVOKE ALL ON TABLE "telemetry"."signal_storage_activations" FROM PUBLIC;
REVOKE ALL ON FUNCTION "telemetry".assert_signal_storage_activation_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION "telemetry".assert_signal_storage_activation_transition() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_migrator') THEN
    GRANT SELECT, INSERT ON "telemetry"."signal_storage_activations" TO "project_migrator";
    GRANT EXECUTE ON FUNCTION "telemetry".assert_signal_storage_activation_immutable() TO "project_migrator";
    GRANT EXECUTE ON FUNCTION "telemetry".assert_signal_storage_activation_transition() TO "project_migrator";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_telemetry_writer') THEN
    GRANT SELECT ON "telemetry"."signal_storage_activations" TO "project_telemetry_writer";
  END IF;
END
$$;
