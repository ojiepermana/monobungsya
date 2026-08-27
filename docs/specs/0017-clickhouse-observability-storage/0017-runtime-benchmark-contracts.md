# 0017. Runtime and benchmark contracts

## Summary

Storage berubah, tetapi arti telemetry dan benchmark tidak berubah. Backend tetap memakai typed telemetry, W3C trace context, bounded sampling, mergeable metric, reproducible benchmark, dan overhead gate yang sudah dibuktikan spec 0014. Child ini membawa kontrak itu maju agar spec 0014 dapat menjadi dokumen historis sepenuhnya.

## Scope

Kontrak berlaku pada gateway, domain service, jobs service, worker, scheduler, notification service, dan MCP. Boundary wajib adalah HTTP masuk dan keluar, SQL, NATS, durable job, scheduler, SMTP, filesystem, dan subprocess. Function internal mendapat span manual hanya ketika proses bisnisnya kritis.

## Runtime interface

`packages/telemetry` tetap mengekspos typed context serta measurement. Ia tidak mengetahui PostgreSQL atau ClickHouse dan mengirim canonical Span serta Metric Bucket ke `ObservabilitySignalStore`.

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
  currentContext(): TelemetryContext | undefined;
  startSpan(definition: SpanDefinition, options?: SpanOptions): SpanHandle;
  withSpan<T>(definition: SpanDefinition, action: () => T): T;
  withSpan<T>(definition: SpanDefinition, action: () => Promise<T>): Promise<T>;
  addCounter(name: MetricName, value?: number, labels?: MetricLabels): void;
  recordHistogram(name: MetricName, value: number, labels?: MetricLabels): void;
  observeGauge(name: MetricName, value: number, labels?: MetricLabels): void;
  extract(carrier: TraceCarrier): TelemetryContext;
  inject(context: TelemetryContext, carrier?: TraceCarrier): TraceCarrier;
  flush(timeoutMs?: number): Promise<FlushResult>;
  shutdown(timeoutMs?: number): Promise<FlushResult>;
}
```

`withSpan` merekam status, monotonic duration, normalized error type, dan safe attributes. Return value serta exception asli tidak pernah ditelan atau diganti. Metric hanya menerima name, unit, histogram boundary, serta label dari typed registry.

## Context and correlation

* `requestId` mengenali satu HTTP attempt.
* `correlationId` mengenali satu perjalanan pengguna dan tetap tersimpan pada legacy `trace_id` sesuai spec 0011.
* `runtimeTraceId` adalah 128 bit W3C trace ID. `runtimeSpanId` adalah 64 bit operation ID.
* `runId` mengenali satu benchmark run dan bukan production request identity.
* Gateway membuat root baru ketika `traceparent` tidak ada atau invalid. Invalid context menambah `telemetry.context.invalid_total`.
* HTTP keluar meneruskan `traceparent`, `x-request-id`, dan `x-correlation-id` secara terpisah.
* NATS memakai message header. Durable job memakai nullable `trace_parent`, bukan domain payload. Scheduler tanpa parent membuat root dan memakai occurrence ID sebagai correlation ID.
* Consumer membuat child dari context valid. Parent relation tetap logical karena row dapat datang tidak berurutan atau sudah lewat retention.
* Application Log, Access Log, dan Audit Trail mempertahankan nullable `runtime_trace_id` serta `runtime_span_id`. Arti legacy `trace_id` tidak berubah.

## Resource and attribute safety

| Kind | Stable resource name |
|---|---|
| `http.server` | Elysia route name atau route template |
| `http.client` | Target service dan route template |
| `db.query` | Query key dari repository |
| `nats.*` | Subject template dari contract registry |
| `job.*` | Job type dan version |
| `scheduler.tick` | Schedule key |
| `smtp.send` | Template atau action key |
| `fs.operation` | Logical action, bukan user path |
| `process.spawn` | Executable class dan logical action, bukan raw arguments |

SQL, SQL parameter, raw URL, query string, request body, header, cookie, token, NATS payload, password, secret, email, user ID, IP, dan free form error message tidak boleh menjadi resource name, attribute, atau metric label. Span memiliki maksimal 32 attribute, key typed, dan string maksimal 256 karakter.

## Sampling and metric aggregation

* Successful production trace memakai deterministic head sampling 5 persen berdasarkan trace ID.
* Error dan operation melewati slow threshold selalu menyimpan local span. Trace ditandai incomplete jika parent lain tidak tersimpan.
* Benchmark trace selalu disimpan dan membawa `run_id`.
* Satu trace maksimal 1.000 Span. Serialized Signal maksimal 4 KiB. Excess data dibuang, trace menjadi incomplete, dan typed drop counter bertambah.
* Slow threshold, sampling rate, histogram boundary, serta label registry berasal dari versioned Git manifest. Manifest checksum menjadi health metric.
* Production Metric Bucket berdurasi 60 detik. Fingerprint adalah SHA256 dari metric name, service instance, resource, unit, dan canonical sorted labels.
* Setiap process menulis cumulative snapshot per bucket. Reader menggabungkan snapshot terbaru antarinstance.
* Histogram boundary wajib identik untuk satu metric. Percentile dihitung dari merged histogram dan tidak pernah disimpan atau menggabungkan percentile per process.
* `SERVICE_INSTANCE_ID` wajib unik untuk satu process lifetime pada staging serta production. Restart memakai ID baru agar `flush_sequence` tetap monotonic dalam identity yang sama.

## Bun runtime probes

* Duration memakai `Bun.nanoseconds()` atau monotonic source setara yang diuji.
* CPU process, RSS, JavaScriptCore heap, event loop lag, throughput, error, dan operation count menjadi typed metric.
* `process.on('memoryPressure')` warning menurunkan success sampling dan mempercepat flush.
* Level critical menghentikan success sampling serta mempertahankan priority reserve. Sampling pulih bertahap setelah lima menit tanpa event baru.
* Probe tidak mengubah cache bisnis, worker state, request acceptance, atau process exit code.

## Elysia lifecycle and shutdown

`createTelemetryPlugin` tetap named Elysia plugin dengan global lifecycle. Plugin didaftarkan setelah request ID tersedia dan sebelum route serta access log completion hook. Root span selesai setelah final response diketahui. Access logger menulis tepat satu Access Log dan hanya menambahkan runtime trace link dari context.

Shutdown menghentikan intake, menunggu operation aktif sesuai batas service, menutup span aktif, memanggil `ObservabilitySignalStore.shutdown`, lalu menyelesaikan strict resource cleanup. Timeout membuang antrean tersisa, mengembalikan written, dropped, timeout, serta failure count, dan menulis safe console diagnostic. Shutdown tidak menunggu tanpa batas.

## Benchmark sources of truth

```text
benchmarks/scenarios/*.json       Scenario manifests
benchmarks/baselines/**/*.json    Approved immutable baseline snapshots
benchmarks/impact-map.json        Source path to affected scenario mapping
CI artifact JSON                  Run and Comparison source
CI artifact Markdown              Human report derived from JSON
PostgreSQL projection             Operator read model only
```

Git adalah sumber Scenario dan Baseline. CI artifact adalah sumber Run dan Comparison. PostgreSQL projection menyimpan source commit, source checksum, artifact URI, dan ingestion time agar stale projection terlihat.

## Scenario, run, and baseline contract

Scenario manifest wajib memiliki `scenario_id`, `scenario_version`, `kind`, `overhead_policy`, runner, fixture version, warmup iterations, measured iterations, timeout, tags, required resource kinds, dan manifest checksum. Kind adalah `journey`, `microbenchmark`, atau `throughput`. Overhead policy adalah `required` atau `diagnostic`.

Run memakai UUIDv7 dan merekam scenario identity, commit, branch, Bun version, instrumentation schema version, environment, observed runner profile, fixture, start, finish, lifecycle status, telemetry completeness, dropped count, overhead values, artifact URI, trace URI, dan safe failure reason. Comparison status terpisah dari lifecycle dan bernilai `pass`, `fail`, `calibrating`, atau `not_comparable`.

Runner profile menggabungkan manifest dengan observed OS, architecture, CPU, core count, memory, Bun version, network class, effective sampling, dan instrumentation mode. Canonical JSON dihash. Perbedaan manifest dan observation membuat run incomplete.

Baseline adalah immutable Git snapshot yang menunjuk approved run. Compatibility key mencakup scenario version, kind, overhead policy, fixture, environment, runner profile, instrumentation schema, dan threshold policy. Hanya satu baseline aktif per compatibility key. Bun version dan commit boleh berbeda dan selalu ditampilkan.

Kalibrasi membutuhkan sedikitnya 20 valid official runs dan 20 inlier sesudah Tukey outlier fence. Coefficient of variation setiap metric maksimal 10 persen. Approved run adalah observed medoid terdekat dari median vector. Promosi hanya melalui pull request dan baseline lama tetap ada dalam Git history.

## Measurement and regression policy

* Setiap scenario melakukan warmup lalu lima measured groups. Candidate value adalah median lima group.
* Percentile scenario memiliki sedikitnya 100 observation per metric.
* Run incomplete ketika coefficient of variation lebih dari 10 persen, driver CPU lebih dari 80 persen, driver event loop lag `p95` lebih dari 10 ms, atau saturation guard tidak valid.
* Instrumentation off dan on dibandingkan pada candidate yang sama untuk telemetry change, nightly, dan release.
* Journey serta throughput gagal jika instrumentation menambah latency `p95` atau CPU lebih dari 5 persen, atau RSS lebih dari 10 persen. Microbenchmark hanya diagnostic.
* General latency regression gagal jika `p95` memburuk lebih dari 10 persen dan lebih dari 5 ms. CPU, RSS, serta throughput memakai threshold 10 persen.
* Error baru gagal ketika baseline nol. Baseline yang sudah memiliki error memakai 10 persen dan sedikitnya satu error tambahan.
* Operation count mempunyai scenario maximum agar N plus one pada query, message, SMTP, atau HTTP keluar terlihat.
* Run tanpa compatible baseline menghasilkan `not_comparable` dan report, bukan false pass.
* Baseline yang sudah drift juga bukan alasan menyatakan lulus. Comparison terakhir gagal dengan driver CPU sekitar `+21,7` persen dan throughput sekitar `-19,0` persen, tetapi replay dari commit sebelum perubahan storage pada host yang sama menghasilkan angka yang cocok dengan run baru dan berbeda dari artifact yang disetujui. Ini menunjuk baseline drift atau beban runner, bukan regresi. Selama baseline belum dikalibrasi ulang, gate overhead dilaporkan terbuka.
* Kalibrasi baseline resmi memerlukan 20 run pada runner terkendali dengan cukup Tukey inlier, coefficient of variation setiap metric dalam batas, dan event loop `p95` dalam batas. Percobaan kalibrasi lokal yang gagal syarat itu tidak boleh dipromosikan menjadi baseline.

## Artifact and ingestion contract

Artifact JSON memakai schema version, canonical key order, UTC time, explicit numeric unit, dan SHA256 checksum. Markdown hanya diturunkan dari JSON yang sama. Secret, token, cookie, email, user ID, body, SQL, dan payload dilarang.

CI mengirim canonical document maksimal 5 MiB ke `/internal/observability/benchmark-ingestions` dengan key ID, timestamp, nonce, serta HMAC SHA256 signature atas method, path, timestamp, nonce, dan body checksum. Clock skew maksimal 60 detik. Active serta previous key mendukung rotation.

PostgreSQL `telemetry.ingestion_receipts` mempertahankan replay serta idempotency contract. Retry key, nonce, dan checksum sama mengembalikan stored response. Nonce sama dengan checksum berbeda ditolak. Seluruh Run, Baseline, Comparison, dan source metadata ditulis dalam satu PostgreSQL transaction.

## Operator and enforcement contracts

* Public trace, metric, benchmark, baseline, serta alert routes dan per signal permission dari spec 0016 tetap ada.
* Trace menampilkan incomplete dan orphan secara jujur. Missing metric bucket menjadi gap, bukan nol.
* `scripts/check-observability.ts` tetap menolak new uninstrumented seam dan memakai versioned inventory untuk debt lama.
* `scripts/check-dependencies.ts` menjaga shared package dan mencegah import lintas service.
* Plugin order, context propagation, stable name, safe attributes, duration, status, unchanged outcome, sampling, aggregation, serta recursion exclusion memiliki contract test.
* CPU profile CLI tetap `bun run observability:profile --service <name> --pid <pid> --duration <seconds>`, maksimal 60 detik, satu profile per service, artifact private, dan retention 24 jam. Unsupported runtime keluar sebagai `unsupported_runtime`. Heap snapshot tetap di luar scope.

## Rationale

Pergantian storage tidak mengubah bahasa yang sudah dipakai producer atau bukti benchmark yang sudah diratifikasi. Mempertahankan contract ini membuat perubahan dapat diukur sebagai storage migration, bukan rewrite instrumentation sekaligus. Satu perubahan sengaja dilakukan: queue dan writer policy lama diganti oleh child Signal karena envelope baru memerlukan byte cap, batch lebih besar, serta ClickHouse ACK semantics.
