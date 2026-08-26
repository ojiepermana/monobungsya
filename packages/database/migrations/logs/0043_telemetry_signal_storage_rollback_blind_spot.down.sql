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

ALTER TABLE "telemetry"."signal_storage_activations"
  DROP CONSTRAINT IF EXISTS telemetry_signal_storage_activations_rollback_blind_spot_check;

ALTER TABLE "telemetry"."signal_storage_activations"
  DROP COLUMN IF EXISTS blind_spot_since;
