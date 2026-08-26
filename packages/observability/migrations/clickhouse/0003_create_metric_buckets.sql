CREATE TABLE IF NOT EXISTS observability.metric_buckets
(
  bucket_start DateTime64(6, 'UTC'),
  bucket_width_seconds UInt32,
  series_fingerprint FixedString(64),
  flush_sequence UInt64,
  service_name String,
  service_instance_id String,
  resource_kind String,
  resource_name String,
  metric_name String,
  metric_kind Enum8('counter' = 1, 'histogram' = 2, 'gauge' = 3),
  unit String,
  count UInt64,
  sum Float64,
  min Float64,
  max Float64,
  histogram_boundaries Array(Float64),
  histogram_counts Array(UInt64),
  labels String CODEC(ZSTD(3)),
  schema_version UInt16,
  ingested_at DateTime64(6, 'UTC')
)
ENGINE = ReplacingMergeTree(flush_sequence)
PARTITION BY toDate(bucket_start)
ORDER BY (metric_name, service_name, resource_kind, resource_name, bucket_start, series_fingerprint)
TTL bucket_start + INTERVAL 30 DAY DELETE
SETTINGS non_replicated_deduplication_window = 10000
