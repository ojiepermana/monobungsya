CREATE TABLE IF NOT EXISTS observability.application_logs
(
  id UUID,
  level String,
  channel String,
  category String,
  event Nullable(String),
  module Nullable(String),
  message String CODEC(ZSTD(3)),
  context Nullable(String) CODEC(ZSTD(3)),
  exception_class Nullable(String),
  exception_message Nullable(String),
  stack_trace Nullable(String) CODEC(ZSTD(3)),
  actor_user_id Nullable(UUID),
  actor_name Nullable(String),
  actor_email Nullable(String),
  entity_type Nullable(String),
  entity_id Nullable(String),
  reference_no Nullable(String),
  branch_code Nullable(String),
  request_id Nullable(String),
  trace_id Nullable(String),
  runtime_trace_id Nullable(FixedString(32)),
  runtime_span_id Nullable(FixedString(16)),
  session_id Nullable(String),
  ip_address Nullable(String),
  user_agent Nullable(String),
  occurred_at DateTime64(6, 'UTC'),
  created_at DateTime64(6, 'UTC'),
  schema_version UInt16,
  ingested_at DateTime64(6, 'UTC'),
  write_version UInt64
)
ENGINE = ReplacingMergeTree(write_version)
PARTITION BY toDate(occurred_at)
ORDER BY (ifNull(module, ''), level, ifNull(event, ''), occurred_at, id)
TTL occurred_at + INTERVAL 30 DAY DELETE
SETTINGS non_replicated_deduplication_window = 10000
