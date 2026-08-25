GRANT UPDATE ON "telemetry"."metric_buckets" TO "project_telemetry_writer";

CREATE OR REPLACE FUNCTION "telemetry".cleanup_expired(
  p_span_retention interval DEFAULT interval '7 days',
  p_metric_retention interval DEFAULT interval '30 days',
  p_benchmark_retention interval DEFAULT interval '90 days'
) RETURNS TABLE (
  spans_deleted bigint,
  metric_buckets_deleted bigint,
  benchmark_comparisons_deleted bigint,
  benchmark_runs_deleted bigint,
  receipts_deleted bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, telemetry
AS $$
DECLARE
  cutoff_spans timestamp := (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - p_span_retention;
  cutoff_metrics timestamp := (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - p_metric_retention;
  cutoff_benchmarks timestamp := (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - p_benchmark_retention;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('telemetry.retention', 0));

  DELETE FROM "telemetry"."spans"
  WHERE started_at < cutoff_spans;
  GET DIAGNOSTICS spans_deleted = ROW_COUNT;

  DELETE FROM "telemetry"."metric_buckets"
  WHERE bucket_start < cutoff_metrics;
  GET DIAGNOSTICS metric_buckets_deleted = ROW_COUNT;

  DELETE FROM "telemetry"."benchmark_comparisons" comparisons
  USING "telemetry"."benchmark_runs" runs
  WHERE comparisons.run_id = runs.run_id
    AND runs.created_at < cutoff_benchmarks
    AND NOT EXISTS (
      SELECT 1
      FROM "telemetry"."benchmark_baselines" baselines
      WHERE baselines.approved_run_id = runs.run_id
    );
  GET DIAGNOSTICS benchmark_comparisons_deleted = ROW_COUNT;

  DELETE FROM "telemetry"."benchmark_runs" runs
  WHERE runs.created_at < cutoff_benchmarks
    AND NOT EXISTS (
      SELECT 1
      FROM "telemetry"."benchmark_baselines" baselines
      WHERE baselines.approved_run_id = runs.run_id
    );
  GET DIAGNOSTICS benchmark_runs_deleted = ROW_COUNT;

  DELETE FROM "telemetry"."ingestion_receipts"
  WHERE expires_at < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
  GET DIAGNOSTICS receipts_deleted = ROW_COUNT;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION "telemetry".cleanup_expired(interval, interval, interval) FROM PUBLIC;

DO $$
DECLARE
  role_name name;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'project_jobs_runtime'::name,
    'project_telemetry_writer'::name
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION "telemetry".cleanup_expired(interval, interval, interval) TO %I',
        role_name
      );
    END IF;
  END LOOP;
END
$$;
