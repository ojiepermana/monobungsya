REVOKE INSERT ON
  "telemetry"."benchmark_runs",
  "telemetry"."benchmark_baselines",
  "telemetry"."benchmark_comparisons",
  "telemetry"."ingestion_receipts"
FROM "project_logs_writer";
REVOKE INSERT, UPDATE ON "telemetry"."alert_states" FROM "project_logs_writer";
