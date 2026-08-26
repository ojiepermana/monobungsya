# 0014. Adopt a Bun observability and benchmarking standard

**Date**: 2026-08-25
**Status**: Superseded
**Superseded by**: [0017](../0017-hybrid-observability-storage/index.md)

## Summary

Backend Bun akan memakai satu kontrak telemetry untuk mengukur request, query, message, job, dan proses keluar lain. Data runtime disimpan secara terbatas di PostgreSQL, sedangkan benchmark memakai skenario dan baseline berversi di Git serta artifact CI. Standar ini memperluas subsistem log tanpa mengubah arti request ID atau correlation ID yang sudah dipakai.

## Structure

* [Runtime telemetry](0014-runtime-telemetry.md) menetapkan context, span, metric, storage, sampling, dan seam instrumentasi.
* [Benchmark and baselines](0014-benchmark-baselines.md) menetapkan scenario, runner, run, baseline, comparison, dan pemeriksaan regresi CI.
* [Operator surfaces and alerting](0014-operator-alerting.md) menetapkan API, viewer, ingestion, permission, alert, notification, dan profile CLI.

Kontrak lintas anak ada di dokumen ini. Jika child spec berbeda dengan kontrak lintas anak, dokumen ini yang berlaku.

## Decision

**Chosen option**: typed PostgreSQL telemetry with Git controlled benchmarks.

Gunakan API telemetry typed milik repositori, W3C `traceparent`, probe runtime Bun, queue terbatas, partisi PostgreSQL, dan artifact benchmark canonical. Jangan memakai logger sebagai transport metric, dan jangan menambahkan OpenTelemetry Collector, Tempo, atau Prometheus pada keputusan ini. (basis: [spec 0011](../0011-log-subsystem/index.md), `packages/logger`, `packages/database`, Bun 1.4 runtime and benchmarking documentation)

**Implementation skills**: `elysiajs` (`elysiajs/elysia`, `.agents/skills/elysiajs/`)

## Standard definition

**Canonical pattern**:

```typescript
const app = new Elysia()
  .use(createTelemetryPlugin({ telemetry }))
  .use(routes);

export async function listUsers(
  database: DatabaseClient,
  telemetry: Telemetry,
) {
  return telemetry.withSpan(
    {
      resourceKind: 'db.query',
      resourceName: 'users.list',
      operation: 'select',
    },
    () => database`SELECT id, email FROM "user"."users" ORDER BY created_at`,
  );
}
```

`createTelemetryPlugin` adalah plugin bernama dengan lifecycle global. Plugin didaftarkan sebelum route agar Elysia menerapkan hook ke semua route setelahnya. `withSpan` menutup span pada sukses maupun error, lalu melempar kembali error asli tanpa mengubah hasil bisnis. Query key berasal dari repository dan bukan dari SQL mentah. (basis: `elysiajs` skill, Elysia lifecycle and plugin documentation)

**Cross child contract**:

* `requestId` mengenali satu percobaan HTTP.
* `correlationId` mengenali satu perjalanan pengguna. Nilai ini tetap memakai `x-correlation-id` dan tetap tersimpan pada kolom `trace_id` lama sesuai spec 0011.
* `runtimeTraceId` adalah ID trace W3C 128 bit pada `telemetry.spans.trace_id`.
* `spanId` adalah ID operasi 64 bit. `parentSpanId` membentuk hubungan parent.
* `runId` mengenali satu benchmark run dan tidak dipakai sebagai identity request production.
* `traceparent` membawa runtime trace melalui HTTP, NATS, dan durable job. Nilai invalid membuat root baru dan menambah metric invalid context.
* Tabel log lama mendapat kolom nullable `runtime_trace_id` dan `runtime_span_id`. Kolom `trace_id` lama tidak diubah maknanya.
* Semua duration memakai waktu monotonic. Timestamp UTC hanya dipakai untuk korelasi tampilan lintas proses.
* Telemetry tidak boleh mengubah response, transaction, message delivery, job state, atau exit code aplikasi.

**Replaces**:

* Pemanggilan `performance.now()` atau event logger yang berdiri sendiri untuk mengukur operasi backend.
* Pemakaian `traceId` lama sebagai distributed trace ID.
* Query SQL, `fetch`, NATS, SMTP, filesystem, atau subprocess baru tanpa wrapper telemetry dan resource name yang stabil.
* Metric berupa row mentah per operasi atau percentile yang dihitung terpisah per proses lalu digabungkan.

**Enforcement**:

* `#project/telemetry` menjadi satu satunya API untuk span dan metric aplikasi.
* Type union menutup daftar resource kind, metric name, sampling reason, dan attribute schema.
* `scripts/check-observability.ts` memindai backend dan gagal pada direct seam baru. Inventory berversi mengizinkan pelanggaran lama sampai dimigrasikan, tetapi CI menolak penambahan inventory tanpa alasan.
* `scripts/check-dependencies.ts` menjaga paket telemetry tetap shared infrastructure dan melarang import lintas service.
* Test kontrak membuktikan plugin Elysia bernama, global, terdaftar sebelum route, dan tidak menulis access log kedua.
* Benchmark workload `journey` dan `throughput` membuktikan tambahan latency `p95` dan CPU tidak lebih dari 5 persen serta RSS tidak lebih dari 10 persen. Microbenchmark raw tetap menyimpan overhead sebagai diagnostic.

**Rollout**:

Gunakan Tracer Bullet secara bertahap. Kode backend baru langsung mengikuti standar. Migrasi lama dimulai dari perjalanan session dan user sampai SQL, storage, API, viewer, dan CI bekerja sebagai satu alur tipis. Alur job dan notification berikutnya menambahkan NATS serta worker. Service lain, MCP, SMTP, filesystem, dan subprocess menyusul dengan mengurangi inventory pada setiap slice. CI gate tetap report only sampai 20 run valid dan environment staging terisolasi tersedia.

**Exceptions**:

* Query writer pada schema `telemetry` tidak diinstrumentasi agar tidak membentuk loop.
* Migration, seed, OpenAPI generation, unit test biasa, dan local development tidak aktif secara default.
* Angular dan Tauri hanya meneruskan correlation context pada tahap ini. Resource browser dan Rust berada di luar cakupan.
* CPU profile sementara memakai CLI operator dan tidak melewati API telemetry normal.

## Consequences

**Positive**:

* Satu vocabulary menghubungkan request, query, message, job, log, metric, trace, dan benchmark.
* Baseline dapat direproduksi karena scenario, fixture, runner profile, threshold, dan source commit selalu tercatat.
* Tidak ada tiga service observability baru yang harus dioperasikan.
* Log security dan audit tetap mempunyai kontrak terpisah yang sudah terbukti.

**Negative and tradeoffs**:

* Tim memiliki format trace, histogram, query API, retention, dan alert evaluator sendiri.
* Telemetry dan aplikasi berbagi failure domain PostgreSQL. Full PostgreSQL outage menjadi blind spot sementara.
* Trace error atau lambat yang tidak masuk deterministic sampling dapat hanya berisi span lokal dan wajib ditandai incomplete.
* Driver HTTP berbasis Bun dapat menjadi bottleneck. Run tidak sah ketika saturation guard gagal.
* Daily partition, queue, benchmark staging, dan projection ingestion menambah pekerjaan operasi.

**Neutral**:

* Existing logger, `ActivityLog`, access log, dan permission log tidak diganti.
* Permission baru, database role baru, manifest baru, migration baru, dan halaman operator baru diperlukan.
* Bun release benchmark adalah referensi runtime, bukan target performa aplikasi ini.

## Follow-up

* [x] Daftarkan feature buildable untuk implementasi standar ini pada `docs/scope/scope.md` sebelum `/develop` dimulai.
* [x] Rekam kelas staging terisolasi, URL target, dan ownership cleanup dalam runner profile sebelum CI gate dapat menjadi required.
* [ ] `elysiajs` belum tercatat dalam root `AGENTS.md`. Konvensi plugin dan lifecycle yang berlaku lintas backend sebaiknya dicatat pada root context sebelum implementasi.
* [ ] Tinjau ulang pilihan OpenTelemetry ketika dukungan Bun tercantum resmi atau ketika biaya merawat query dan storage internal melampaui biaya operasi Collector.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
