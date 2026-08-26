CREATE TABLE IF NOT EXISTS observability.spans
(
  trace_id FixedString(32),
  span_id FixedString(16),
  parent_span_id Nullable(FixedString(16)),
  correlation_id Nullable(String),
  request_id Nullable(String),
  run_id Nullable(UUID),
  service_name String,
  service_instance_id String,
  resource_kind String,
  resource_name String,
  operation String,
  status Enum8('ok' = 1, 'error' = 2, 'unset' = 3),
  sampling_reason String,
  attributes String CODEC(ZSTD(3)),
  error_type Nullable(String),
  started_at DateTime64(6, 'UTC'),
  finished_at DateTime64(6, 'UTC'),
  duration_ns UInt64,
  schema_version UInt16,
  ingested_at DateTime64(6, 'UTC'),
  write_version UInt64
)
ENGINE = ReplacingMergeTree(write_version)
PARTITION BY toDate(started_at)
ORDER BY (service_name, resource_kind, resource_name, started_at, trace_id, span_id)
TTL started_at + INTERVAL 7 DAY DELETE
SETTINGS non_replicated_deduplication_window = 10000
