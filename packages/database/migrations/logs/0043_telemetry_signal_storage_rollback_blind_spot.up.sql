ALTER TABLE "telemetry"."signal_storage_activations"
  ADD COLUMN IF NOT EXISTS blind_spot_since timestamp NULL;

ALTER TABLE "telemetry"."signal_storage_activations"
  ADD CONSTRAINT telemetry_signal_storage_activations_rollback_blind_spot_check
  CHECK (
    (activation_kind <> 'rollback' AND blind_spot_since IS NULL)
    OR (
      activation_kind = 'rollback'
      AND (
        (from_write_mode = 'dual' AND blind_spot_since IS NULL)
        OR (from_write_mode = 'clickhouse' AND blind_spot_since IS NOT NULL)
      )
    )
  );

CREATE OR REPLACE FUNCTION "telemetry".assert_signal_storage_activation_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_write_mode varchar(20);
  current_read_mode varchar(20);
  current_report_id uuid;
  current_activated_at timestamp;
  report_from_write_mode varchar(20);
  report_from_read_mode varchar(20);
  report_to_write_mode varchar(20);
  report_to_read_mode varchar(20);
  report_allowed boolean;
  rollback_shadow_until timestamp;
  rollback_shadow_available boolean;
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

  SELECT to_write_mode, to_read_mode, report_id, activated_at
  INTO current_write_mode, current_read_mode, current_report_id, current_activated_at
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

  IF NEW.activation_kind = 'rollback' THEN
    IF current_write_mode = 'clickhouse' THEN
      IF NEW.blind_spot_since IS DISTINCT FROM current_activated_at THEN
        RAISE EXCEPTION 'telemetry.signal_storage_activations writer rollback must record the writer cutover instant as Blind Spot'
          USING ERRCODE = '55000';
      END IF;
    ELSIF current_write_mode = 'dual' AND current_read_mode = 'clickhouse' THEN
      SELECT
        ((evidence -> 'rollbackWindow' ->> 'endsAt')::timestamptz AT TIME ZONE 'UTC'),
        COALESCE((evidence -> 'rollbackWindow' ->> 'postgresShadowAvailable')::boolean, false)
      INTO rollback_shadow_until, rollback_shadow_available
      FROM "telemetry"."signal_promotion_reports"
      WHERE id = current_report_id;

      IF rollback_shadow_available IS DISTINCT FROM true
        OR rollback_shadow_until IS NULL
        OR (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') >= rollback_shadow_until THEN
        RAISE EXCEPTION 'telemetry.signal_storage_activations PostgreSQL shadow rollback window has expired'
          USING ERRCODE = '55000';
      END IF;
      IF NEW.blind_spot_since IS NOT NULL THEN
        RAISE EXCEPTION 'telemetry.signal_storage_activations safe shadow rollback cannot record a Blind Spot'
          USING ERRCODE = '55000';
      END IF;
    ELSE
      RAISE EXCEPTION 'telemetry.signal_storage_activations rollback source is invalid'
        USING ERRCODE = '55000';
    END IF;
  ELSIF NEW.blind_spot_since IS NOT NULL THEN
    RAISE EXCEPTION 'telemetry.signal_storage_activations only writer rollback may record a Blind Spot'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
