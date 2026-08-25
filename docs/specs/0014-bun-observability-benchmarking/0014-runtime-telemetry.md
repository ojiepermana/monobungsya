# 0014. Runtime telemetry standard

## Summary

Setiap runtime backend Bun mengukur boundary penting melalui API typed yang sama. Span sampled dan metric agregat masuk ke schema `telemetry` melalui koneksi khusus yang tidak mengukur dirinya sendiri. Logger lama tetap menangani application, audit, dan access log.

## Scope

Standar berlaku untuk gateway, domain service, jobs service, worker, scheduler, notification service, dan MCP. Boundary wajib adalah HTTP masuk dan keluar, SQL, NATS, durable job, scheduler, SMTP, filesystem, dan subprocess. Function internal hanya mendapat span manual ketika proses bisnisnya kritis.

## Runtime contract

Paket baru `packages/telemetry` memiliki kontrak berikut.

```typescript
type ResourceKind =
  | 'http.server'
  | 'http.client'
  | 'db.query'
  | 'nats.publish'
  | 'nats.request'
  | 'nats.consume'
  | 'job.enqueue'
  | 'job.execute'
  | 'scheduler.tick'
  | 'smtp.send'
  | 'fs.operation'
  | 'process.spawn'
  | 'business.operation';

interface Telemetry {
  withSpan<T>(definition: SpanDefinition, action: () => T): T;
  withSpan<T>(definition: SpanDefinition, action: () => Promise<T>): Promise<T>;
  addCounter(name: MetricName, value: number, labels?: MetricLabels): void;
  recordHistogram(name: MetricName, value: number, labels?: MetricLabels): void;
  observeGauge(name: MetricName, value: number, labels?: MetricLabels): void;
  extract(carrier: TraceCarrier): TelemetryContext;
  inject(context: TelemetryContext, carrier: TraceCarrier): TraceCarrier;
  flush(timeoutMs?: number): Promise<FlushResult>;
  shutdown(timeoutMs?: number): Promise<FlushResult>;
}
```

`withSpan` merekam status, duration, dan error type yang dinormalisasi. Ia tidak menelan atau mengganti return value maupun exception. `addCounter`, `recordHistogram`, dan `observeGauge` hanya menerima nama serta label dari registry typed.

## Context propagation

* Gateway membuat `traceparent` baru ketika header tidak ada atau invalid.
* HTTP keluar meneruskan `traceparent`, `x-request-id`, dan `x-correlation-id` secara terpisah.
* NATS memakai message headers untuk `traceparent` dan correlation ID. Payload domain tidak berubah.
* Durable job menambah kolom nullable `trace_parent` pada `jobs.job` dan field pada `EnqueueJobInput`. Nilai ini bukan bagian payload operator.
* Scheduler tanpa parent membuat trace root baru dan memakai occurrence ID sebagai correlation ID.
* Consumer membuat child span dari context valid. Context invalid membuat root baru dan metric `telemetry.context.invalid_total`.

## Resource naming

Nama resource tidak boleh membawa nilai bisnis.

```text
http.server     Elysia route name atau route template
http.client     target service + route template
db.query        query key dari repository, contoh users.list
nats.*          subject template dari contract registry
job.*           job type + version
scheduler.tick  schedule key
smtp.send       template atau action key
fs.operation    logical action, bukan path pengguna
process.spawn   executable class + logical action, bukan argument mentah
```

SQL, parameter SQL, URL mentah, query string, body, header, cookie, token, payload NATS, alamat email, user ID, IP, dan error message bebas tidak boleh menjadi resource name, attribute, atau label.

## Data model

### `telemetry.spans`

Partisi harian memakai `started_at`. Retention adalah 7 hari.

```text
trace_id             char(32) required
span_id              char(16) required
parent_span_id       char(16) nullable
correlation_id       varchar(100) nullable
request_id           varchar(100) nullable
run_id               uuid nullable
service_name         varchar(50) required
service_instance_id  varchar(100) required
resource_kind        varchar(40) required
resource_name        varchar(150) required
operation            varchar(50) required
status               varchar(20) required
sampling_reason      varchar(20) required
attributes           jsonb required
error_type           varchar(100) nullable
started_at           timestamp required
finished_at          timestamp required
duration_ns          bigint required
```

Primary key adalah `(trace_id, span_id, started_at)`. Parent relation bersifat logical karena span dapat datang tidak berurutan atau sudah lewat retention. Index utama mencakup trace, correlation, request, run, status, serta `(service_name, resource_kind, resource_name, started_at)`.

### `telemetry.metric_buckets`

Partisi harian memakai `bucket_start`. Retention adalah 30 hari. Production memakai bucket 60 detik.

```text
bucket_start          timestamp required
bucket_width_seconds  smallint required
series_fingerprint    char(64) required
flush_sequence        bigint required
service_name          varchar(50) required
service_instance_id   varchar(100) required
resource_kind         varchar(40) required
resource_name         varchar(150) required
metric_name           varchar(100) required
metric_kind           varchar(20) required
unit                  varchar(30) required
count                 bigint required
sum                   double precision required
min                   double precision required
max                   double precision required
histogram_boundaries  double precision[] required
histogram_counts      bigint[] required
labels                jsonb required
```

Primary key adalah `(bucket_start, series_fingerprint)`. Fingerprint adalah SHA256 dari metric name, service instance, resource, unit, dan label canonical yang sudah diurutkan. Setiap process menulis snapshot kumulatif untuk satu bucket. Upsert hanya mengganti snapshot ketika `flush_sequence` yang masuk lebih besar. Sequence yang sama menjadi no op, sehingga retry tidak menggandakan count atau histogram. Reader menjumlahkan snapshot antar instance. Histogram boundary berasal dari registry per metric dan wajib sama untuk setiap writer. Percentile tidak pernah disimpan atau digabungkan.

### Existing log correlation

Tambah kolom nullable `runtime_trace_id char(32)` dan `runtime_span_id char(16)` pada `logs.logging`, `logs.access_logs`, dan `logs.audit_trails` beserta semua partisi. Index hanya diperlukan pada `runtime_trace_id`. Existing `trace_id` tetap menyimpan correlation ID agar spec 0011 dan viewer lama tidak berubah.

## Sampling and limits

* Successful production trace memakai deterministic sample 5 persen berdasarkan `trace_id`.
* Error dan operasi yang melewati slow threshold selalu menyimpan span lokal. Trace diberi `incomplete` ketika parent lain tidak tersimpan.
* Benchmark trace selalu disimpan dan membawa `run_id`.
* Maksimal 1000 span per trace, 32 attribute per span, 256 karakter per string, dan 4096 byte serialized item.
* Excess data dibuang, trace ditandai incomplete, dan counter drop ditambah.
* Slow threshold, sampling rate, histogram boundary, dan label registry berasal dari manifest Git berversi. Checksum manifest masuk ke metric kesehatan telemetry.

## Queue and writer

Default queue adalah 2000 item dengan 500 slot yang dicadangkan untuk error dan slow span. Batch maksimal 200 item atau flush setiap 1000 ms. Writer memakai `TELEMETRY_DATABASE_URL`, pool maksimal 2 connection, role `project_telemetry_writer`, dan tidak pernah melewati wrapper instrumentasi.

Validasi berjalan sebelum enqueue. Satu batch memakai transaction. Insert span memakai `ON CONFLICT DO NOTHING`. Metric bucket mengikuti aturan sequence di atas. Error transient mendapat tiga retry dengan exponential backoff dan jitter. Error permanen memecah batch untuk mengisolasi poison item. Poison item dibuang, dihitung, dan dilaporkan ke console tanpa menggagalkan operasi bisnis.

Ketika queue penuh, data prioritas rendah dibuang lebih dahulu. Ketika PostgreSQL pulih, total kehilangan yang masih ada di memory ditulis sebagai metric. Full PostgreSQL outage tetap menjadi blind spot sementara.

## Bun runtime probes

* Duration memakai `Bun.nanoseconds()` atau sumber monotonic setara yang diuji.
* CPU proses, RSS, JavaScriptCore heap, event loop lag, throughput, error, dan operation count menjadi metric typed.
* `process.on('memoryPressure')` warning menurunkan success sampling dan mempercepat flush.
* Level critical menghentikan success sampling, mempertahankan priority lane, dan memperkecil queue.
* Sampling pulih bertahap setelah lima menit tanpa event baru. Telemetry tidak mengubah cache bisnis, worker state, atau penerimaan request.
* Detail CPU profile tidak berjalan terus dan berada pada child operator.

## Elysia lifecycle

`createTelemetryPlugin` adalah plugin bernama dan memakai lifecycle global. Plugin didaftarkan setelah request ID tersedia, tetapi sebelum route dan access log completion hook. Root span selesai setelah response final dapat diketahui. Access log spec 0011 tetap menulis tepat satu access row dan hanya menambahkan runtime trace link dari context.

## Shutdown

Setiap composition root menghentikan intake, menunggu operasi aktif sesuai batas service, menutup span aktif, flush telemetry maksimal `TELEMETRY_FLUSH_TIMEOUT_MS`, flush `ActivityLog`, lalu menutup koneksi. Timeout telemetry membuang sisa queue, menulis console record aman, dan tidak memperpanjang shutdown tanpa batas. Crash dapat kehilangan queue di memory dan instance baru wajib memakai ID baru.

## Configuration

```text
TELEMETRY_ENABLED
TELEMETRY_DATABASE_URL
TELEMETRY_QUEUE_CAPACITY default 2000
TELEMETRY_PRIORITY_CAPACITY default 500
TELEMETRY_BATCH_SIZE default 200
TELEMETRY_FLUSH_INTERVAL_MS default 1000
TELEMETRY_FLUSH_TIMEOUT_MS default 5000
TELEMETRY_SUCCESS_SAMPLE_RATE default 0.05
TELEMETRY_RULES_PATH
SERVICE_INSTANCE_ID required in staging and production
```

Telemetry aktif pada staging dan production ketika infrastructure aktif, serta aktif khusus pada benchmark CI. Unit test dan local development tidak aktif kecuali diminta. Schema atau koneksi yang belum siap tidak menggagalkan service production. Benchmark readiness harus gagal sampai telemetry siap.

## Standard checks

* Plugin order dan deduplication diuji pada setiap `createApp`.
* Setiap seam membuktikan context propagation, stable name, safe attributes, duration, status, dan unchanged business outcome.
* Writer membuktikan batching, retry, poison isolation, overflow priority, recovery count, shutdown timeout, dan recursion exclusion.
* Clock skew tidak mengubah duration. Pohon trace memakai parent relation dan memberi warning pada tampilan yang skew.
* Instrumentation overhead pada workload `journey` dan `throughput` memenuhi batas 5 persen untuk latency `p95` dan CPU serta 10 persen untuk RSS. Microbenchmark raw tetap melaporkan overhead sebagai diagnostic karena tidak memiliki kerja aplikasi yang menjadi pembagi.

## Consequences

Paket ini memberi kontrak compile time dan satu seam per resource. Biayanya adalah custom sampling, histogram, writer, dan PostgreSQL query path yang harus dipelihara. Direct SQL lama tetap menjadi debt sampai rollout menghapus inventory.
