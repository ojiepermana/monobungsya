CREATE SCHEMA IF NOT EXISTS "telemetry";

ALTER TABLE "logs"."logging"
  ADD COLUMN IF NOT EXISTS runtime_trace_id char(32),
  ADD COLUMN IF NOT EXISTS runtime_span_id char(16);
ALTER TABLE "logs"."audit_trails"
  ADD COLUMN IF NOT EXISTS runtime_trace_id char(32),
  ADD COLUMN IF NOT EXISTS runtime_span_id char(16);
ALTER TABLE "logs"."access_logs"
  ADD COLUMN IF NOT EXISTS runtime_trace_id char(32),
  ADD COLUMN IF NOT EXISTS runtime_span_id char(16);

CREATE INDEX IF NOT EXISTS logs_logging_runtime_trace_id_idx
  ON "logs"."logging" (runtime_trace_id);
CREATE INDEX IF NOT EXISTS logs_audit_trails_runtime_trace_id_idx
  ON "logs"."audit_trails" (runtime_trace_id);
CREATE INDEX IF NOT EXISTS logs_access_logs_runtime_trace_id_idx
  ON "logs"."access_logs" (runtime_trace_id);

CREATE TABLE IF NOT EXISTS "telemetry"."spans" (
  trace_id char(32) NOT NULL,
  span_id char(16) NOT NULL,
  parent_span_id char(16) NULL,
  correlation_id varchar(100) NULL,
  request_id varchar(100) NULL,
  run_id uuid NULL,
  service_name varchar(50) NOT NULL,
  service_instance_id varchar(100) NOT NULL,
  resource_kind varchar(40) NOT NULL,
  resource_name varchar(150) NOT NULL,
  operation varchar(50) NOT NULL,
  status varchar(20) NOT NULL,
  sampling_reason varchar(20) NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_type varchar(100) NULL,
  started_at timestamp NOT NULL,
  finished_at timestamp NOT NULL,
  duration_ns bigint NOT NULL,
  CONSTRAINT telemetry_spans_pkey PRIMARY KEY (trace_id, span_id, started_at),
  CONSTRAINT telemetry_spans_trace_id_hex CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  CONSTRAINT telemetry_spans_span_id_hex CHECK (span_id ~ '^[0-9a-f]{16}$'),
  CONSTRAINT telemetry_spans_status_check CHECK (status IN ('ok', 'error', 'unset'))
) PARTITION BY RANGE (started_at);

CREATE INDEX IF NOT EXISTS telemetry_spans_trace_started_idx
  ON "telemetry"."spans" (trace_id, started_at);
CREATE INDEX IF NOT EXISTS telemetry_spans_correlation_idx
  ON "telemetry"."spans" (correlation_id, started_at);
CREATE INDEX IF NOT EXISTS telemetry_spans_request_idx
  ON "telemetry"."spans" (request_id, started_at);
CREATE INDEX IF NOT EXISTS telemetry_spans_run_idx
  ON "telemetry"."spans" (run_id, started_at);
CREATE INDEX IF NOT EXISTS telemetry_spans_resource_idx
  ON "telemetry"."spans" (service_name, resource_kind, resource_name, started_at);

CREATE TABLE IF NOT EXISTS "telemetry"."metric_buckets" (
  bucket_start timestamp NOT NULL,
  bucket_width_seconds smallint NOT NULL,
  series_fingerprint char(64) NOT NULL,
  flush_sequence bigint NOT NULL,
  service_name varchar(50) NOT NULL,
  service_instance_id varchar(100) NOT NULL,
  resource_kind varchar(40) NOT NULL,
  resource_name varchar(150) NOT NULL,
  metric_name varchar(100) NOT NULL,
  metric_kind varchar(20) NOT NULL,
  unit varchar(30) NOT NULL,
  count bigint NOT NULL,
  sum double precision NOT NULL,
  min double precision NOT NULL,
  max double precision NOT NULL,
  histogram_boundaries double precision[] NOT NULL,
  histogram_counts bigint[] NOT NULL,
  labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT telemetry_metric_buckets_pkey PRIMARY KEY (bucket_start, series_fingerprint),
  CONSTRAINT telemetry_metric_buckets_kind_check CHECK (metric_kind IN ('counter', 'histogram', 'gauge'))
) PARTITION BY RANGE (bucket_start);

CREATE INDEX IF NOT EXISTS telemetry_metric_buckets_series_idx
  ON "telemetry"."metric_buckets" (metric_name, service_name, resource_kind, resource_name, bucket_start);

CREATE TABLE IF NOT EXISTS "telemetry"."benchmark_runs" (
  run_id uuid PRIMARY KEY DEFAULT uuidv7(),
  scenario_id varchar(120) NOT NULL,
  scenario_version varchar(50) NOT NULL,
  status varchar(30) NOT NULL,
  source_commit_sha varchar(64) NOT NULL,
  source_branch varchar(255) NULL,
  source_checksum char(64) NOT NULL,
  fixture_version varchar(100) NOT NULL,
  environment varchar(50) NOT NULL,
  runner_profile jsonb NOT NULL,
  instrumentation_schema_version varchar(50) NOT NULL,
  threshold_policy_version varchar(50) NOT NULL,
  bun_version varchar(50) NOT NULL,
  artifact_uri text NULL,
  trace_uri text NULL,
  artifact_checksum char(64) NULL,
  completeness varchar(30) NOT NULL DEFAULT 'complete',
  started_at timestamp NOT NULL,
  finished_at timestamp NULL,
  created_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CONSTRAINT telemetry_benchmark_runs_status_check CHECK (status IN ('running', 'passed', 'failed', 'not_comparable', 'incomplete')),
  CONSTRAINT telemetry_benchmark_runs_completeness_check CHECK (completeness IN ('complete', 'incomplete'))
);

CREATE INDEX IF NOT EXISTS telemetry_benchmark_runs_scenario_idx
  ON "telemetry"."benchmark_runs" (scenario_id, scenario_version, created_at DESC);

CREATE TABLE IF NOT EXISTS "telemetry"."benchmark_baselines" (
  baseline_id uuid PRIMARY KEY DEFAULT uuidv7(),
  scenario_id varchar(120) NOT NULL,
  scenario_version varchar(50) NOT NULL,
  approved_run_id uuid NOT NULL REFERENCES "telemetry"."benchmark_runs" (run_id),
  fixture_version varchar(100) NOT NULL,
  environment varchar(50) NOT NULL,
  runner_profile jsonb NOT NULL,
  instrumentation_schema_version varchar(50) NOT NULL,
  threshold_policy_version varchar(50) NOT NULL,
  approval_commit_sha varchar(64) NOT NULL,
  metric_snapshot jsonb NOT NULL,
  supersedes_baseline_id uuid NULL REFERENCES "telemetry"."benchmark_baselines" (baseline_id),
  active boolean NOT NULL DEFAULT true,
  promoted_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
);

CREATE UNIQUE INDEX IF NOT EXISTS telemetry_benchmark_baselines_one_active_idx
  ON "telemetry"."benchmark_baselines" (scenario_id, scenario_version, fixture_version, environment, instrumentation_schema_version)
  WHERE active;

CREATE TABLE IF NOT EXISTS "telemetry"."benchmark_comparisons" (
  comparison_id uuid PRIMARY KEY DEFAULT uuidv7(),
  run_id uuid NOT NULL REFERENCES "telemetry"."benchmark_runs" (run_id),
  baseline_id uuid NULL REFERENCES "telemetry"."benchmark_baselines" (baseline_id),
  resource_kind varchar(40) NOT NULL,
  resource_name varchar(150) NOT NULL,
  metric_key varchar(150) NOT NULL,
  statistic varchar(20) NOT NULL,
  unit varchar(30) NOT NULL,
  baseline_value double precision NULL,
  candidate_value double precision NOT NULL,
  absolute_delta double precision NULL,
  relative_delta_percent double precision NULL,
  absolute_threshold double precision NULL,
  relative_threshold double precision NULL,
  decision varchar(20) NOT NULL,
  evidence_uri text NULL,
  created_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CONSTRAINT telemetry_benchmark_comparisons_decision_check CHECK (decision IN ('pass', 'fail', 'not_comparable'))
);

CREATE INDEX IF NOT EXISTS telemetry_benchmark_comparisons_run_idx
  ON "telemetry"."benchmark_comparisons" (run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS "telemetry"."alert_states" (
  rule_id varchar(120) NOT NULL,
  rule_version varchar(50) NOT NULL,
  series_fingerprint char(64) NOT NULL,
  status varchar(20) NOT NULL,
  consecutive_breach_windows integer NOT NULL DEFAULT 0,
  transition_sequence bigint NOT NULL DEFAULT 0,
  first_breached_at timestamp NULL,
  last_evaluated_at timestamp NOT NULL,
  evidence_bucket timestamp NULL,
  last_notified_at timestamp NULL,
  resolved_at timestamp NULL,
  PRIMARY KEY (rule_id, rule_version, series_fingerprint),
  CONSTRAINT telemetry_alert_states_status_check CHECK (status IN ('pending', 'firing', 'resolved', 'unknown'))
);

CREATE TABLE IF NOT EXISTS "telemetry"."ingestion_receipts" (
  key_id varchar(100) NOT NULL,
  nonce varchar(150) NOT NULL,
  ingestion_id uuid NOT NULL,
  body_checksum char(64) NOT NULL,
  response_status smallint NOT NULL,
  response_checksum char(64) NOT NULL,
  response_body jsonb NOT NULL,
  expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  PRIMARY KEY (key_id, nonce),
  CONSTRAINT telemetry_ingestion_receipts_ingestion_unique UNIQUE (ingestion_id, body_checksum)
);

DO $$
DECLARE
  current_year integer := EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))::integer;
  target_year integer;
BEGIN
  FOR target_year IN current_year..(current_year + 1) LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS "telemetry"."spans_%s" PARTITION OF "telemetry"."spans" FOR VALUES FROM (%L) TO (%L)',
      target_year,
      make_timestamp(target_year, 1, 1, 0, 0, 0),
      make_timestamp(target_year + 1, 1, 1, 0, 0, 0)
    );
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS "telemetry"."metric_buckets_%s" PARTITION OF "telemetry"."metric_buckets" FOR VALUES FROM (%L) TO (%L)',
      target_year,
      make_timestamp(target_year, 1, 1, 0, 0, 0),
      make_timestamp(target_year + 1, 1, 1, 0, 0, 0)
    );
  END LOOP;
END
$$;

GRANT USAGE ON SCHEMA "telemetry" TO "project_telemetry_writer";
GRANT INSERT, SELECT ON "telemetry"."spans", "telemetry"."metric_buckets" TO "project_telemetry_writer";
GRANT USAGE ON SCHEMA "telemetry" TO "project_telemetry_reader";
GRANT SELECT ON ALL TABLES IN SCHEMA "telemetry" TO "project_telemetry_reader";
GRANT SELECT ON "telemetry"."benchmark_runs", "telemetry"."benchmark_baselines", "telemetry"."benchmark_comparisons", "telemetry"."alert_states" TO "project_logs_writer";
