DROP TRIGGER IF EXISTS telemetry_signal_promotion_reports_immutable
  ON "telemetry"."signal_promotion_reports";
DROP FUNCTION IF EXISTS "telemetry".assert_signal_promotion_report_immutable();
DROP TABLE IF EXISTS "telemetry"."signal_promotion_reports";
