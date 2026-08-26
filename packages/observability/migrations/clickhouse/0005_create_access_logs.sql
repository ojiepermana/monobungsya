CREATE TABLE IF NOT EXISTS observability.access_logs
(
  id UUID,
  event String,
  outcome String,
  authentication_method Nullable(String),
  access_channel String,
  guard Nullable(String),
  actor_user_id Nullable(UUID),
  actor_name Nullable(String),
  actor_email Nullable(String),
  branch_code Nullable(String),
  ip_address Nullable(String),
  forwarded_ip Nullable(String),
  user_agent Nullable(String),
  device_name Nullable(String),
  platform Nullable(String),
  browser Nullable(String),
  session_id Nullable(String),
  request_id Nullable(String),
  trace_id Nullable(String),
  runtime_trace_id Nullable(FixedString(32)),
  runtime_span_id Nullable(FixedString(16)),
  route_name Nullable(String),
  path Nullable(String),
  method Nullable(String),
  http_status Nullable(UInt16),
  failure_reason Nullable(String),
  metadata Nullable(String) CODEC(ZSTD(3)),
  accessed_at DateTime64(6, 'UTC'),
  created_at DateTime64(6, 'UTC'),
  schema_version UInt16,
  ingested_at DateTime64(6, 'UTC'),
  write_version UInt64
)
ENGINE = ReplacingMergeTree(write_version)
PARTITION BY toDate(accessed_at)
ORDER BY (ifNull(route_name, ''), outcome, event, accessed_at, id)
TTL accessed_at + INTERVAL 30 DAY DELETE
SETTINGS non_replicated_deduplication_window = 10000
