# 0017. Signal storage

## Summary

Empat Observability Signal memakai satu deep module dan satu canonical record per entity. Module menerima Signal secara sinkron ke antrean bounded, membentuk batch per tabel, lalu menulis langsung ke ClickHouse lewat HTTP. Kegagalan storage menghasilkan drop serta Blind Spot yang terlihat dan tidak pernah mengubah business outcome.

## Module ownership

`packages/observability` memiliki:

* Canonical discriminated union untuk Span, Metric Bucket, Application Log, dan Access Log.
* Interface `ObservabilitySignalStore` serta adapter contract test.
* Queue byte accounting, priority reserve, fair scheduling, batching, retry, poison isolation, insert token, flush, shutdown, dan diagnostics.
* ClickHouse HTTP adapter sebagai satu satunya implementasi runtime, fake untuk unit test, ClickHouse migration, version manifest, dan local runner. Tidak ada adapter PostgreSQL Signal dan tidak ada mekanisme untuk menambah target kedua melalui configuration.

`packages/telemetry` tetap memiliki context, propagation, sampling, Span lifecycle, runtime probe, dan Metric aggregation. `packages/logger` tetap memiliki sanitization, Application Log serta Access Log creation, dan strict Audit Trail. Kedua package mengirim canonical Signal melalui interface yang diinjeksi composition root.

## External interface

```typescript
type ObservabilitySignal =
  | SpanSignal
  | MetricBucketSignal
  | ApplicationLogSignal
  | AccessLogSignal;

type AppendResult =
  | { status: 'accepted' }
  | {
      status: 'dropped';
      reason:
        | 'disabled'
        | 'shutting_down'
        | 'queue_full'
        | 'oversize'
        | 'invalid_time'
        | 'invalid_schema';
    };

interface SignalFlushResult {
  written: number;
  dropped: number;
  timedOut: boolean;
  failed: boolean;
}

interface SignalStoreDiagnostics {
  state: 'available' | 'blind_spot' | 'disabled';
  queueDepth: number;
  queueBytes: number;
  droppedByReason: Readonly<Record<string, number>>;
  blindSpotSince: string | null;
  lastAcknowledgedAt: string | null;
  schemaVersion: number;
  failureCode: string | null;
  written: number;
  dropped: number;
}

interface ObservabilitySignalStore {
  append(signal: ObservabilitySignal): AppendResult;
  flush(timeoutMs?: number): Promise<SignalFlushResult>;
  shutdown(timeoutMs?: number): Promise<SignalFlushResult>;
  diagnostics(): SignalStoreDiagnostics;
}
```

`append` hanya melakukan canonical validation, serialized byte measurement, priority classification, dan enqueue. Ia tidak menunggu network atau storage dan tidak melempar storage error. `flush` serta `shutdown` selalu bounded dan mengembalikan hasil. `written` berarti row mendapat ACK dari ClickHouse setelah async buffer berhasil flush ke disk. Karena hanya ada satu target, tidak ada per target count dan tidak ada hasil sebagian antar storage. `shutdown` menghentikan intake sebelum drain.

Adapter interface, batch type, SQL, HTTP parameter, table name, retry classification, dan client error tetap internal. Caller tidak mendapat method per signal kind.

## Canonical Signal records

Semua producer records memakai camel case dalam TypeScript dan diubah menjadi snake case pada adapter. Producer mengisi domain fields serta `schemaVersion`. Store memperkaya accepted record dengan `ingestedAt` dan version sebelum row menjadi stored canonical record. Required atau nullable state mengikuti schema saat ini, kecuali metadata storage baru yang selalu required pada stored record.

### Span

```text
traceId, spanId, parentSpanId nullable
correlationId nullable, requestId nullable, runId nullable
serviceName, serviceInstanceId
resourceKind, resourceName, operation
status, samplingReason, attributes canonical JSON
errorType nullable
startedAt, finishedAt, durationNs
schemaVersion, ingestedAt, writeVersion
```

`traceId` adalah lowercase hex 32 karakter dan `spanId` lowercase hex 16 karakter. `parentSpanId` nullable dengan format sama. Status hanya `ok`, `error`, atau `unset`. Stable identity adalah `(traceId, spanId, startedAt)`.

### Metric Bucket

```text
bucketStart, bucketWidthSeconds
seriesFingerprint, flushSequence
serviceName, serviceInstanceId
resourceKind, resourceName
metricName, metricKind, unit
count, sum, min, max
histogramBoundaries, histogramCounts
labels canonical JSON
schemaVersion, ingestedAt
```

Metric kind hanya `counter`, `histogram`, atau `gauge`. Stable identity adalah `(bucketStart, seriesFingerprint)`. `flushSequence` adalah version dan hanya naik dalam satu `serviceInstanceId` lifetime.

### Application Log

```text
id, level, channel, category
event nullable, module nullable, message
context canonical JSON nullable
exceptionClass nullable, exceptionMessage nullable, stackTrace nullable
actorUserId nullable, actorName nullable, actorEmail nullable
entityType nullable, entityId nullable, referenceNo nullable, branchCode nullable
requestId nullable, traceId nullable
runtimeTraceId nullable, runtimeSpanId nullable
sessionId nullable, ipAddress nullable, userAgent nullable
occurredAt, createdAt
schemaVersion, ingestedAt, writeVersion
```

Stable identity adalah `(id, occurredAt)`. `id` tetap UUIDv7 yang dibuat producer sebelum enqueue.

### Access Log

```text
id, event, outcome
authenticationMethod nullable, accessChannel, guard nullable
actorUserId nullable, actorName nullable, actorEmail nullable
branchCode nullable, ipAddress nullable, forwardedIp nullable, userAgent nullable
deviceName nullable, platform nullable, browser nullable
sessionId nullable, requestId nullable, traceId nullable
runtimeTraceId nullable, runtimeSpanId nullable
routeName nullable, path nullable, method nullable, httpStatus nullable
failureReason nullable, metadata canonical JSON nullable
accessedAt, createdAt
schemaVersion, ingestedAt, writeVersion
```

Stable identity adalah `(id, accessedAt)`. `id` tetap UUIDv7 yang dibuat producer sebelum enqueue.

## ClickHouse database and tables

Database tetap bernama `observability`. Canonical JSON disimpan sebagai compressed `String` dengan deterministic key order. Dimension berulang memakai `LowCardinality(String)` ketika compatibility serta capacity test lulus. Time memakai `DateTime64(6, 'UTC')`. Duration nanosecond memakai unsigned integer. UUIDv7 memakai `UUID`. Runtime trace serta span ID memakai fixed lowercase hex string.

| Table | Engine | Partition | Sort key | Version | TTL |
|---|---|---|---|---|---|
| `spans` | `ReplacingMergeTree(write_version)` | `toDate(started_at)` | service, resource kind, resource name, start, trace ID, span ID | `write_version` | `started_at + 7 DAY` |
| `metric_buckets` | `ReplacingMergeTree(flush_sequence)` | `toDate(bucket_start)` | metric, service, resource kind, resource name, bucket start, fingerprint | `flush_sequence` | `bucket_start + 30 DAY` |
| `application_logs` | `ReplacingMergeTree(write_version)` | `toDate(occurred_at)` | normalized module, level, normalized event, occurred time, ID | `write_version` | `occurred_at + 30 DAY` |
| `access_logs` | `ReplacingMergeTree(write_version)` | `toDate(accessed_at)` | normalized route, outcome, event, accessed time, ID | `write_version` | `accessed_at + 30 DAY` |

Nullable dimension pada sort key memakai expression yang menormalisasi null menjadi empty string. Column aslinya tetap nullable sehingga public contract tidak berubah.

Data skipping index atau projection yang dapat dibangun ulang melayani `trace_id`, `runtime_trace_id`, `runtime_span_id`, `request_id`, `correlation_id`, `run_id`, dan bounded text search. Exact index type serta granularity ditetapkan oleh capacity test, tetapi canonical sort key tidak berubah tanpa table version baru.

Read path tidak menganggap background merge sudah selesai. Ia memilih version terbaru per stable identity dengan bounded latest row query atau rebuildable projection. Unbounded `FINAL` pada retention penuh dilarang. Field yang ikut sort key bersifat immutable untuk stable identity yang sama. Metric update hanya boleh mengubah aggregate values dan `flush_sequence`. Derived trace summary, filter option, dan SLO projection tidak menjadi sumber kebenaran serta dapat dibangun ulang dari canonical tables.

## Relationships

ClickHouse tidak memakai foreign key.

* Satu trace memiliki banyak Span melalui `trace_id`. Parent relation memakai nullable `parent_span_id`.
* Application Log dan Access Log dapat menunjuk satu Span melalui `runtime_trace_id` serta `runtime_span_id`.
* Request dan perjalanan pengguna memakai `request_id`, legacy `trace_id`, serta `correlation_id` sesuai contract yang dibawa maju.
* Metric dikorelasikan melalui service, resource, label registry, dan time range. Metric tidak menunjuk Span individual.
* PostgreSQL Benchmark Run dapat menunjuk banyak Span melalui logical `run_id`.

Missing related row valid karena sampling, retention, failure, atau arrival order. Reader memberi incomplete atau Blind Spot dan tidak membuat synthetic relationship.

## Schema evolution

`schema_version` adalah positive integer required pada setiap row dan typed constant pada setiap canonical record. Perubahan additive menambah nullable column atau column dengan deterministic default serta mempertahankan reader lama. Breaking change membuat table version baru dan memerlukan spec baru, karena tidak ada dual write atau backfill yang dapat memindahkan row antar version. Jalur yang tersedia adalah menulis version baru ke depan dan membiarkan version lama habis oleh TTL.

Writer startup memeriksa exact supported schema version serta required table setting. Writer tidak mengirim row ke schema yang lebih tua atau lebih baru dari support matrix. Mismatch adalah kesalahan deployment, sehingga process menolak start dengan diagnostic yang aman dan deployment gate ikut gagal. ClickHouse yang hanya tidak dapat dihubungi bukan mismatch dan hanya membuka Blind Spot.

## Ingestion path

1. Producer membentuk canonical record, menjalankan sanitization yang sudah ada, menetapkan event time, dan memanggil `append`.
2. Store memvalidasi schema, time, serialized bytes, serta priority. Valid record mendapat `ingestedAt` dan version sekali, lalu masuk antrean.
3. Fair scheduler membentuk batch dengan satu signal kind dan satu schema version. Scheduler mencegah satu kind memonopoli seluruh in flight slot.
4. Batch mendapat UUIDv7 `batchId`. ClickHouse adapter mengirim `JSONEachRow` melalui Bun `fetch` langsung ke HTTP endpoint table yang tepat.
5. Request selalu membawa `async_insert=1`, `wait_for_async_insert=1`, deduplication enabled, stable insert token dari `batchId`, bounded request timeout, dan writer identity.
6. Hanya successful disk flush ACK yang memperbarui `lastAcknowledgedAt` serta written count.

ClickHouse LTS `26.3.17.110` dipin agar async serta sync insert deduplication contract tersedia pada binary yang masih mendapat security update. Plain non replicated MergeTree memiliki positive `non_replicated_deduplication_window` paling sedikit 10.000 block. Retry memakai token dan query identity yang sama. Stable row version tetap menjadi perlindungan kedua ketika deduplication window sudah lewat.

## Queue, priority, and batch policy

Total antrean per process berhenti pada batas pertama yang tercapai, yaitu 20.000 Signal atau 32 MiB serialized bytes. Byte measurement dilakukan sebelum enqueue dengan encoder yang sama dengan request body.

Reserve 20 persen hanya dapat dipakai oleh:

* Span berstatus error.
* Span yang melewati slow threshold.
* Application Log level error atau lebih berat.
* Access Log outcome gagal atau HTTP status 500 ke atas.

Ketika pressure naik, sampled success Span, debug atau info Application Log, dan successful Access Log dibuang lebih dahulu. Metric Bucket serta health Signal tidak mengambil reserve tetapi dijadwalkan adil agar tidak starvation. Setiap drop memperbarui typed reason counter. Unplanned pressure drop membuka Blind Spot. Deterministic sampling yang memang direncanakan tidak membuka Blind Spot.

Satu batch berhenti pada 5.000 row atau 4 MiB. Flush berjalan setiap 500 ms. Maksimal empat batch berada in flight per process. Batch tidak diubah setelah sealed agar retry byte content, row version, dan token identik.

## Retry and failure classification

Network error, connection reset, request timeout, HTTP 429, dan HTTP 5xx dianggap transient. Retry maksimal tiga kali memakai exponential backoff dengan jitter dan tetap bounded oleh flush atau shutdown deadline.

Authentication, authorization, unknown table, unsupported schema, invalid setting, dan non row specific HTTP 4xx dianggap permanent batch failure. Store membelah batch secara rekursif hanya ketika response menunjukkan row atau schema data problem yang dapat diisolasi. Valid half tetap ditulis. Single poison row dibuang dan dihitung.

Retry final yang gagal, queue pressure drop, atau acknowledged result yang tidak dapat dipastikan membuka atau memperpanjang Blind Spot. Successful ACK pertama setelah connectivity dan schema health pulih mencatat safe recovery diagnostic, mengosongkan active `blindSpotSince`, dan mengubah state kembali available. Availability alert history di PostgreSQL mempertahankan interval node failure. Diagnostic hanya memuat failure code, signal kind, batch ID, count, attempt, dan safe timing. Row, SQL, URL credential, body, actor, email, IP, token, serta secret tidak pernah dicetak.

`flush` menyelesaikan sealed serta queued batch sampai deadline. `shutdown` menolak intake baru sebelum drain. Timeout membuang sisa row secara terhitung. Tidak ada disk spool, dead letter queue, NATS, atau JetStream pada keputusan ini.

## Time, retention, and loss

Event time diterima ketika tidak lebih tua dari retention entity serta tidak lebih dari lima menit di masa depan terhadap UTC adapter clock. Tidak ada pengecualian migration, karena tidak ada backfill. Invalid time dan oversize row ditolak sebelum enqueue dan dicatat sebagai data quality diagnostic.

TTL berjalan saat ClickHouse merge. Operator boleh melihat row sampai empat jam sesudah logical expiry. Query selalu menerapkan time bound sehingga expired row tidak bocor hanya karena merge tertunda.

Tidak ada cold archive atau Signal backup. Kehilangan process dapat menghilangkan memory queue. Kehilangan node dapat menghilangkan seluruh retained Signal. Aplikasi membangun database kosong melalui migration runner, memulai retention baru, dan mencatat interval hilang sebagai Blind Spot di PostgreSQL Control serta operator health.

## Rationale

Satu external interface memberi leverage karena caller tidak perlu mempelajari empat writer, queue rules, atau HTTP settings. Interface itu tetap dipertahankan meskipun sekarang hanya ada satu adapter runtime, karena justru interface inilah yang membuat penghapusan adapter PostgreSQL menjadi pekerjaan satu paket dan bukan pekerjaan lintas seluruh producer. Fake untuk unit test tetap menjadi implementasi kedua, sehingga contract suite masih menguji interface. Empat canonical entity tetap terpisah karena field, retention, stable identity, dan query shape berbeda. Satu generic event table akan menghasilkan nullable field besar, sort key lemah, dan query yang sulit diprediksi.

Direct HTTP dengan acknowledged async insert menggabungkan batching server side dengan error yang masih terlihat caller. Fire and forget tidak dipakai karena ACK sebelum disk flush akan membuat drop tidak dapat dihitung. ReplacingMergeTree serta stable token dipakai bersama karena deduplication ClickHouse bersifat windowed dan background merge bersifat eventual.
