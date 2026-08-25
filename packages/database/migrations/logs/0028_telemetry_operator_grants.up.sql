GRANT SELECT, INSERT ON
  "telemetry"."benchmark_runs",
  "telemetry"."benchmark_baselines",
  "telemetry"."benchmark_comparisons",
  "telemetry"."ingestion_receipts"
TO "project_logs_writer";
GRANT SELECT, INSERT, UPDATE ON "telemetry"."alert_states" TO "project_logs_writer";
