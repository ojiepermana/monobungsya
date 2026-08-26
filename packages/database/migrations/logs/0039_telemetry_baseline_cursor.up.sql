CREATE INDEX IF NOT EXISTS telemetry_benchmark_baselines_promoted_cursor_idx
  ON "telemetry"."benchmark_baselines" (promoted_at DESC, baseline_id);
