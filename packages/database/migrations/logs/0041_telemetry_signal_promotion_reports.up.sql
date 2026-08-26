CREATE TABLE IF NOT EXISTS "telemetry"."signal_promotion_reports" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  from_write_mode varchar(20) NOT NULL,
  from_read_mode varchar(20) NOT NULL,
  to_write_mode varchar(20) NOT NULL,
  to_read_mode varchar(20) NOT NULL,
  evaluated_at timestamp NOT NULL,
  evidence jsonb NOT NULL,
  decision jsonb NOT NULL,
  artifact_uri text NOT NULL,
  recorded_by varchar(200) NOT NULL,
  recorded_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CONSTRAINT telemetry_signal_promotion_reports_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7),
  CONSTRAINT telemetry_signal_promotion_reports_from_write_mode_check
    CHECK (from_write_mode IN ('postgres', 'dual', 'clickhouse')),
  CONSTRAINT telemetry_signal_promotion_reports_from_read_mode_check
    CHECK (from_read_mode IN ('postgres', 'clickhouse')),
  CONSTRAINT telemetry_signal_promotion_reports_to_write_mode_check
    CHECK (to_write_mode IN ('postgres', 'dual', 'clickhouse')),
  CONSTRAINT telemetry_signal_promotion_reports_to_read_mode_check
    CHECK (to_read_mode IN ('postgres', 'clickhouse')),
  CONSTRAINT telemetry_signal_promotion_reports_to_mode_valid_check
    CHECK (
      (to_write_mode = 'postgres' AND to_read_mode = 'postgres')
      OR (to_write_mode = 'dual' AND to_read_mode IN ('postgres', 'clickhouse'))
      OR (to_write_mode = 'clickhouse' AND to_read_mode = 'clickhouse')
    ),
  CONSTRAINT telemetry_signal_promotion_reports_from_mode_valid_check
    CHECK (
      (from_write_mode = 'postgres' AND from_read_mode = 'postgres')
      OR (from_write_mode = 'dual' AND from_read_mode IN ('postgres', 'clickhouse'))
      OR (from_write_mode = 'clickhouse' AND from_read_mode = 'clickhouse')
    ),
  CONSTRAINT telemetry_signal_promotion_reports_artifact_uri_nonempty_check
    CHECK (length(btrim(artifact_uri)) > 0),
  CONSTRAINT telemetry_signal_promotion_reports_recorded_by_nonempty_check
    CHECK (length(btrim(recorded_by)) > 0),
  CONSTRAINT telemetry_signal_promotion_reports_evidence_object_check
    CHECK (jsonb_typeof(evidence) = 'object'),
  CONSTRAINT telemetry_signal_promotion_reports_decision_object_check
    CHECK (jsonb_typeof(decision) = 'object')
);

CREATE INDEX IF NOT EXISTS telemetry_signal_promotion_reports_target_idx
  ON "telemetry"."signal_promotion_reports" (
    to_write_mode,
    to_read_mode,
    recorded_at DESC,
    id
  );

CREATE OR REPLACE FUNCTION "telemetry".assert_signal_promotion_report_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'telemetry.signal_promotion_reports rows are immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER telemetry_signal_promotion_reports_immutable
  BEFORE UPDATE OR DELETE ON "telemetry"."signal_promotion_reports"
  FOR EACH ROW
  EXECUTE FUNCTION "telemetry".assert_signal_promotion_report_immutable();

REVOKE ALL ON TABLE "telemetry"."signal_promotion_reports" FROM PUBLIC;
REVOKE ALL ON FUNCTION "telemetry".assert_signal_promotion_report_immutable() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_migrator') THEN
    GRANT SELECT, INSERT ON "telemetry"."signal_promotion_reports" TO "project_migrator";
    GRANT EXECUTE ON FUNCTION "telemetry".assert_signal_promotion_report_immutable() TO "project_migrator";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_telemetry_writer') THEN
    GRANT SELECT ON "telemetry"."signal_promotion_reports" TO "project_telemetry_writer";
  END IF;
END
$$;
