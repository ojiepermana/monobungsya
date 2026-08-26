# 0017. Adopt hybrid observability storage

**Date**: 2026-08-26
**Status**: In Progress

## Summary

Observability Signal yang tumbuh besar akan disimpan di ClickHouse, sedangkan Audit Trail dan Observability Control tetap di PostgreSQL. Pemisahan ini menjaga data operasional yang harus tepat tetap transaksional, sambil memberi log, span, dan metric ruang untuk tumbuh sampai envelope 100 juta baris per hari. Perubahan dilakukan bertahap melalui dual write, backfill, pembuktian kapasitas, lalu cutover yang dapat dibalik.

Spec ini menggantikan spec 0014. Kontrak telemetry, benchmark, korelasi, permission, dan batas overhead yang tidak terkait pilihan storage tetap dipertahankan di sini.

## Structure

* [Runtime and benchmark contracts](0017-runtime-benchmark-contracts.md) membawa maju kontrak typed telemetry, korelasi, sampling, benchmark, dan overhead dari spec 0014.
* [Signal storage](0017-signal-storage.md) menetapkan deep module, empat entity Signal, schema ClickHouse, antrean, batch, retry, retensi, dan Blind Spot.
* [Query and control](0017-query-control.md) menetapkan PostgreSQL Control, read model, cursor, batas query, health, alert, API, dan permission.
* [Cutover and operations](0017-cutover-operations.md) menetapkan instalasi satu node, migrasi schema, kapasitas, dual write, backfill, cutover, rollback, dan operasi produksi.

Kontrak lintas child berada di dokumen ini. Jika child berbeda dengan kontrak lintas child, dokumen ini yang berlaku.

## Requirements

**User stories**:

* Sebagai operator, saya ingin mencari Signal dalam jendela insiden dengan waktu respons yang terukur agar diagnosis tetap berguna ketika volume tumbuh besar.
* Sebagai pemilik proses bisnis, saya ingin Audit Trail dan Control tetap tepat serta transaksional agar kegagalan observability tidak mengubah hasil bisnis.
* Sebagai maintainer, saya ingin satu deep module menyembunyikan storage, antrean, retry, dan batching agar producer tidak mengetahui PostgreSQL atau ClickHouse.
* Sebagai operator platform, saya ingin migrasi dan kegagalan satu node terlihat jelas serta dapat dibalik agar perubahan storage tidak menjadi big bang rewrite.

**Acceptance criteria**:

* **AC-1**: `#project/telemetry` tetap menjadi kontrak typed untuk context, span, dan metric. W3C `traceparent`, arti `requestId`, `correlationId`, `runtimeTraceId`, `runtimeSpanId`, sampling, dan aturan bahwa telemetry tidak boleh mengubah hasil bisnis tetap sesuai kontrak yang dibawa maju dari spec 0014.
* **AC-2**: Benchmark run, baseline Git, comparison, signed ingestion, alert, dan permission tetap berfungsi dengan hasil yang sama. Benchmark membuktikan overhead instrumentation pada latency `p95` dan CPU tidak lebih dari 5 persen serta RSS tidak lebih dari 10 persen.
* **AC-3**: ClickHouse hanya menyimpan empat Observability Signal, yaitu Span, Metric Bucket, Application Log, dan Access Log. PostgreSQL tetap menyimpan `logs.audit_trails` dan seluruh Observability Control. Tidak ada business state atau Control yang dipindahkan ke ClickHouse.
* **AC-4**: Package baru `packages/observability` mengekspos satu interface `ObservabilitySignalStore` yang hanya memiliki `append`, `flush`, `shutdown`, dan `diagnostics`. PostgreSQL adapter sementara dan ClickHouse adapter target berada di balik interface ini. Producer tidak mengimpor client, query, table name, atau error ClickHouse.
* **AC-5**: Database ClickHouse `observability` memiliki tabel `spans`, `metric_buckets`, `application_logs`, dan `access_logs`. Setiap tabel memakai partisi UTC harian, sort key yang ditetapkan child Signal, stable identity, `schema_version`, `ingested_at`, dan version field yang ditetapkan. Hubungan antarsignal bersifat logis tanpa foreign key.
* **AC-6**: TTL menghapus Span setelah 7 hari serta Metric Bucket, Application Log, dan Access Log setelah 30 hari. Tidak ada cold archive. Penghapusan boleh tertunda paling lama empat jam karena dijalankan saat merge dan tidak boleh ditampilkan sebagai retensi yang presisi sampai detik.
* **AC-7**: Waktu event disimpan sebagai `DateTime64` UTC, duration disimpan sebagai integer nanosecond dari monotonic clock, dan zona Asia Jakarta hanya dipakai saat display. Signal yang lebih tua dari retention atau lebih dari lima menit ke masa depan ditolak dengan diagnostic tanpa menggagalkan bisnis. Ukuran serialized Signal maksimal 4 KiB.
* **AC-8**: ClickHouse adapter menulis langsung lewat HTTP dengan `async_insert=1` dan `wait_for_async_insert=1`. Setiap process memiliki antrean maksimal 20.000 Signal atau 32 MiB, reserve prioritas 20 persen, batch maksimal 5.000 row atau 4 MiB, flush 500 ms, dan maksimal empat batch in flight.
* **AC-9**: Transient failure dicoba ulang maksimal tiga kali dengan exponential backoff dan jitter memakai insert token yang sama. Poison row diisolasi dengan pembelahan batch. Setelah retry habis, Signal dibuang, counter serta waktu mulai Blind Spot diperbarui, console diagnostic disanitasi, dan request, transaction, message, job, serta process aplikasi tetap berjalan.
* **AC-10**: Pada hardware produksi yang sama, sistem menerima 100 juta Signal per hari pada rata rata sekitar 1.158 row per detik dan burst 10 kali sekitar 11.574 row per detik. Ukuran rata rata pengujian 1 KiB dan maksimum 4 KiB. Signal yang diterima antrean dapat dicari dengan freshness `p95` paling lama lima detik.
* **AC-11**: Query Signal memenuhi latency `p95` paling lama dua detik untuk rentang sampai 24 jam dan lima detik untuk rentang lebih dari 24 jam sampai 30 hari pada dataset retention penuh. Default rentang adalah 24 jam dengan preset 15 menit, 1 jam, 6 jam, dan 24 jam. Rentang custom maksimum 30 hari.
* **AC-12**: List Application Log dan Access Log memakai keyset cursor dua arah serta mengembalikan `prevCursor`, `nextCursor`, jumlah row halaman ini, filter, options, dan `storageStatus` tanpa exact total. Page size tetap 25. Audit Trail tetap memakai page, total, dan PostgreSQL. Trace list tetap memakai page size 50 dan Metric tetap memakai batas 200 series.
* **AC-13**: Trace, Metric, Benchmark, Baseline, dan Alert API yang sudah ada mempertahankan contract spec 0016. Trace summary, filter options, dan projection Signal yang diturunkan dari empat tabel dapat dibangun ulang dan bukan sumber kebenaran baru.
* **AC-14**: Ketika Signal storage tidak dapat dibaca, list mengembalikan HTTP 200 dengan data kosong dan `storageStatus: blind_spot`, sedangkan detail mengembalikan 503. Cursor atau rentang invalid mengembalikan 422. Signal detail yang sudah lewat retention mengembalikan 404. Query yang ditolak karena concurrency mengembalikan 429 dengan `Retry-After`.
* **AC-15**: Setiap logs service instance membatasi delapan query Signal bersamaan. Hard deadline adalah lima detik untuk rentang sampai 24 jam dan sepuluh detik untuk rentang lebih panjang. Field query memakai allowlist dan seluruh value memakai parameter binding.
* **AC-16**: `GET /internal/observability/storage-health` tidak diproxy gateway, hanya tersedia di jaringan internal, dan memerlukan signed identity yang memiliki setidaknya satu permission observability. Respons memuat state, `blindSpotSince`, dropped count, queue depth, last acknowledged insert, schema version, dan alasan kegagalan yang disanitasi.
* **AC-17**: Jobs service memeriksa ClickHouse setiap 30 detik. System managed availability alert tersimpan di PostgreSQL, menjadi firing setelah dua kegagalan berurutan, dan resolved setelah tiga keberhasilan berurutan. Alert metric biasa menjadi unknown ketika Signal tidak dapat dibaca. Disk alert memakai ambang warning 70 persen, firing 80 persen, dan critical 90 persen.
* **AC-18**: Produksi memakai tiga credential terpisah untuk migrator, writer, dan reader. Koneksi produksi memakai TLS pada jaringan privat, firewall hanya mengizinkan backend, logs service, jobs service, dan migration host yang perlu. Full disk encryption aktif. Token, cookie, authorization header, request body, SQL mentah, password, dan secret tidak pernah disimpan. ClickHouse query log aktif selama tujuh hari dan hanya dapat dibaca operator database.
* **AC-19**: Produksi berjalan pada satu node ClickHouse self hosted yang dipasang native sebagai systemd service pada Linux VM dengan local NVMe. Starting floor adalah 16 vCPU, RAM 64 GiB, dan NVMe 4 TiB. ClickHouse LTS `26.3.17.110` dipin untuk development, staging, serta production sebelum build schema dimulai. Tidak ada Signal backup. Kehilangan node membangun storage kosong dan kehilangan retention dicatat sebagai Blind Spot. Maintenance terencana maksimal 30 menit tidak menghentikan aplikasi.
* **AC-20**: `packages/observability` memiliki Bun migration runner untuk ClickHouse dengan ordered migration, checksum, PostgreSQL history, dan drift detection. Startup memeriksa versi ClickHouse, database, table schema version, dan required settings. Mismatch menonaktifkan Signal storage serta membuka Blind Spot tanpa membuat aplikasi tidak ready, tetapi deployment gate gagal sampai migrasi selesai.
* **AC-21**: Migrasi memakai mode writer `postgres → dual → clickhouse` dan mode reader `postgres → clickhouse`. Shadow dual write berlangsung sedikitnya tujuh hari. Backfill memproses satu partisi UTC harian dari yang paling lama, memakai stable key dan token, checkpoint di `telemetry.signal_migration_runs`, maksimal 30 persen resource node, serta auto pause saat ingest SLO, query SLO, atau disk guard gagal.
* **AC-22**: Reader hanya dipindahkan setelah ClickHouse menerima sedikitnya 99,9 persen batch yang diterima antrean, deterministic sample checksum cocok 100 persen, query parity lulus, dan seluruh ingest serta query SLO hijau. Setelah reader cutover, PostgreSQL shadow write berjalan tujuh hari untuk rollback. Setelah itu PostgreSQL Signal table menjadi read only selama 30 hari dan hanya dihapus oleh migration terpisah.
* **AC-23**: Local development menjalankan native `clickhouse server` melalui script repo dengan temporary data directory dan versi yang dipin. Docker dan Docker Compose tidak dipakai. Unit test dapat memakai fake atau PostgreSQL adapter tanpa ClickHouse aktif.

## Decision

**Chosen option**: Option 2, hybrid storage dengan strangler migration.

Gunakan ClickHouse untuk Observability Signal dan PostgreSQL untuk Audit Trail serta Observability Control. Perkenalkan ClickHouse melalui deep module dan dual write, bukan melalui perubahan langsung di setiap producer. (basis: `CONTEXT.md`, [spec 0011](../0011-log-subsystem/index.md), strangler pattern, [ClickHouse MergeTree documentation](https://clickhouse.com/docs/reference/engines/table-engines/mergetree-family/mergetree))

**Implementation skills**: `elysiajs` (`elysiajs/elysia`, `.agents/skills/elysiajs/`) · `codebase-design` (`local/agent-skills`, `.agents/skills/codebase-design/`)

**Declined tooling**: Pencarian dan pemasangan ClickHouse Agent Skill serta MCP sengaja dilewati sesuai keputusan engineer. Implementasi memakai dokumentasi resmi, contract test, dan capacity test repo.

**Version pin**: ClickHouse LTS `26.3.17.110`. Branch `26.2` tidak lagi mendapat security update, sedangkan LTS ini memberi target patch yang stabil untuk satu node production. Upgrade hanya boleh mengubah manifest melalui pull request yang membuktikan compatibility, parity, dan capacity smoke sebelum binary baru dipromosikan. Runner up adalah stable `26.7.3.19`, tetapi ritme upgrade regulernya tidak sebanding dengan kebutuhan operasi awal satu node.

## Feature design

**Data model sketch**:

| Store | Entity | Stable identity | Event time | Retention |
|---|---|---|---|---|
| ClickHouse | Span | `trace_id`, `span_id`, `started_at` | `started_at` | 7 hari |
| ClickHouse | Metric Bucket | `bucket_start`, `series_fingerprint` | `bucket_start` | 30 hari |
| ClickHouse | Application Log | `id`, `occurred_at` | `occurred_at` | 30 hari |
| ClickHouse | Access Log | `id`, `accessed_at` | `accessed_at` | 30 hari |
| PostgreSQL | Audit Trail | schema spec 0011 tetap | `audited_at` | Kebijakan PostgreSQL yang ada |
| PostgreSQL | Benchmark Run, Baseline, Comparison | schema spec 0014 tetap | Waktu entity masing masing | Kebijakan yang ada |
| PostgreSQL | Alert Rule, Alert State | rule version dan series fingerprint | `last_evaluated_at` | Kebijakan yang ada |
| PostgreSQL | Ingestion Receipt | key ID dan nonce | `created_at` | Lima menit |
| PostgreSQL | Signal Schema Migration | migration version | `applied_at` | Permanen |
| PostgreSQL | Signal Migration Run | run ID dan signal kind | source range | Permanen sampai cleanup operator |
| PostgreSQL | Signal Promotion Report | report UUID dan target mode | `evaluated_at` | Immutable |

Field lengkap serta physical layout terdapat pada child Signal dan Control. Foreign key hanya dipakai di PostgreSQL. ClickHouse memakai hubungan logis melalui trace ID, span ID, request ID, correlation ID, service, resource, time, dan benchmark run ID.

**State transitions**:

* Writer mode: `postgres → dual → clickhouse`. Perpindahan hanya maju setelah gate AC-22 lulus. Selama rollback window, `clickhouse → dual` diperbolehkan.
* Reader mode: `postgres → clickhouse`. Selama PostgreSQL shadow write masih aktif, rollback memakai `clickhouse → postgres` tanpa deployment baru.
* Migration run: `pending → running → paused → running → succeeded`. Error permanen menghasilkan `failed`. Resume memakai checkpoint terakhir.
* Signal storage: `disabled → available → blind_spot → available`. `disabled` dipakai ketika configuration atau schema belum siap. Waktu mulai Blind Spot baru dibersihkan setelah successful ACK mencatat recovery.
* Availability alert: `pending → firing → resolved`, dengan `unknown` untuk evaluasi metric yang tidak memiliki Signal dapat dipercaya.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/v1/logs/application-logs` | GET | time, search, level, module, event, cursor | data, cursors, filters, options, storage status, Blind Spot start | Permission application log yang ada | 422, 429, blind spot 200 |
| `/api/v1/logs/access-logs` | GET | time, search, event, outcome, trace ID, cursor | data, cursors, filters, options, storage status, Blind Spot start | Permission access log yang ada | 422, 429, blind spot 200 |
| `/api/v1/logs/audit-trails` | GET | search, module, action, page | data, exact page meta, filters, options | Permission audit yang ada | 422, 503 |
| `/api/v1/observability/traces` | GET | time, service, resource, status, correlation, request, run, cursor | trace summaries, cursors, completeness, options, storage status | `observability:trace:read` | 422, 429, blind spot 200 |
| `/api/v1/observability/traces/:traceId` | GET | trace ID | spans, orphan roots, completeness | `observability:trace:read` | 404, 503 |
| `/api/v1/observability/metrics` | GET | time, metric, service, resource, group, statistic, step | points, coverage, options | `observability:metric:read` | 422, 429, blind spot 200 |
| `/api/v1/observability/benchmarks/runs`, detail, dan baselines | GET | Filter dan cursor contract child runtime | PostgreSQL Benchmark Control | Permission benchmark yang ada | 404, 422, 503 |
| `/api/v1/observability/alerts/*` | GET | Contract spec 0016 | PostgreSQL alert state dan Signal evidence | `observability:alert:read` | 422, 503 |
| `/internal/observability/benchmark-ingestions` | POST | Signed canonical benchmark artifact | Ingestion ID, checksum, projection count | CI machine identity | 401, 409, 413, 422, 503 |
| `/internal/observability/storage-health` pada setiap Bun backend | GET | none | local store diagnostics | Signed internal identity dengan permission observability mana pun | 401, 403 |

Tidak ada endpoint write publik untuk Signal. Producer memanggil interface in process.

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| `append` | accepted, dropped, reason | Local queue item cap, byte cap, priority reserve, dan schema validation |
| Seal batch | insert token | UUIDv7 batch ID yang dibuat sekali dan dipakai ulang pada setiap retry |
| Store Signal | event time | Field canonical producer, divalidasi terhadap retention dan future skew |
| Store Signal | `ingested_at` | UTC clock ClickHouse adapter ketika row pertama kali diterima |
| Store Signal | `schema_version` | Constant canonical record di `packages/observability` |
| Store Span or Log | `write_version` | Epoch microsecond dari `ingested_at`, dipertahankan pada retry |
| Store Metric Bucket | version | `flush_sequence` dari producer dengan `service_instance_id` unik per process lifetime |
| Diagnostics | queue depth dan dropped count | Counter process local di `ObservabilitySignalStore` |
| Diagnostics | last acknowledged insert | Waktu ACK terakhir dari HTTP insert dengan `wait_for_async_insert=1` |
| Diagnostics | `blindSpotSince` | Waktu retry final pertama gagal, dibawa sampai recovery tercatat |
| Signal list Blind Spot | `blindSpotSince` | Proyeksi aman dari diagnostic process-local yang sama, agar UI gateway tidak perlu mengakses endpoint health internal |
| Storage health auth | Identity dan permission | Existing HMAC signed identity header yang diverifikasi service dan permission catalog spec 0016 |
| Signal list | cursor | Version, direction, sort time, stable ID, dan fingerprint filter dari boundary row |
| Signal list | options | Distinct bounded query atau rebuildable projection dalam time range yang sama |
| Trace read | completeness | Sampling reason, orphan detection, dan drop diagnostic untuk jendela trace |
| Metric read | coverage | Expected bucket dari time range serta step dibanding stored bucket |
| Alert read | state dan transition | `telemetry.alert_states` di PostgreSQL |
| Migration operator | count, checksum, cursor, status | `telemetry.signal_migration_runs` dan hasil source serta target validation |
| UI display | zona waktu | UTC value dari API yang diformat memakai Asia Jakarta di client |

**Key invariants**:

* Observability Signal boleh hilang setelah bounded retry. Audit Trail tidak boleh memakai jalur ini dan gagal secara terlihat bersama business mutation yang mewajibkannya.
* Ketiadaan Signal tidak pernah diartikan sebagai nol atau sehat. API dan alert harus menyatakan Blind Spot atau unknown.
* Satu batch hanya berisi satu signal kind dan satu schema version agar ClickHouse async buffer memiliki shape stabil.
* Retry mempertahankan row identity, write version, dan insert token. Duplicate fisik boleh ada sebelum merge, tetapi read model selalu memilih version terbaru.
* Stable key, sort key, TTL, dan event time tidak boleh berubah tanpa table version baru, dual write, dan migration plan baru.
* `packages/telemetry` tetap memiliki context, sampling, dan metric aggregation. `packages/logger` tetap memiliki sanitization dan Audit Trail. `packages/observability` sendiri memiliki Signal records, queue policy, adapter, dan ClickHouse migrations.
* Derived projection dapat dihapus serta dibangun ulang dari empat canonical table dan tidak boleh mengendalikan business outcome.

**Security model**:

* ClickHouse migrator hanya memiliki DDL pada database `observability`. Writer hanya memiliki INSERT pada empat canonical table. Reader hanya memiliki SELECT yang diperlukan pada canonical table, projection, dan system view yang diperlukan untuk health.
* Hanya service backend yang menghasilkan Signal. Logs service membaca Signal. Jobs service membaca metric serta health dan menulis Control ke PostgreSQL.
* ClickHouse tidak terekspos ke internet. Production wajib TLS, private network, firewall allowlist, secret dari environment, dan full disk encryption.
* Field actor, email, IP, session, dan user agent yang sudah diizinkan spec 0011 boleh disimpan selama retention. Sanitization yang ada tetap berlaku. Token, cookie, authorization header, body, SQL mentah, password, secret, dan payload sensitif dilarang mutlak.
* Semua query memakai parameter binding dan field allowlist. ClickHouse query log disimpan tujuh hari dan hanya operator database yang dapat membacanya.
* Tidak ada compliance khusus yang dinyatakan. Audit Trail tetap strict dan tidak menjadi Observability Signal.

**Configuration required**:

* `OBSERVABILITY_SIGNAL_WRITE_MODE`: `postgres`, `dual`, atau `clickhouse`.
* `OBSERVABILITY_SIGNAL_READ_MODE`: `postgres` atau `clickhouse`.
* `OBSERVABILITY_SIGNAL_PROMOTION_REPORT_ID`: UUID immutable report PostgreSQL Control yang wajib untuk `dual/clickhouse` atau `clickhouse/clickhouse` pada production; runtime menolak target yang tidak cocok, report yang tidak lagi lulus evaluasi gate, atau report yang tidak dibind oleh aktivasi Control aktif.
* `OBSERVABILITY_DATABASE_URL`: connection PostgreSQL Control untuk runtime read-only promotion lookup; wajib dinyatakan eksplisit untuk mode production non-baseline dan tidak mewarisi URL telemetry. Saat menjalankan `bun run observability:promotion:record` atau `bun run observability:promotion:activate`, isi dengan credential operator Control yang terpisah dan berizin INSERT; credential itu tidak dipasang pada backend runtime.
* `CLICKHOUSE_URL`: HTTPS endpoint privat node.
* `CLICKHOUSE_WRITER_USERNAME` dan `CLICKHOUSE_WRITER_PASSWORD`: credential INSERT bagi backend.
* `CLICKHOUSE_READINESS_USERNAME` dan `CLICKHOUSE_READINESS_PASSWORD`: credential catalog terbatas bagi startup writer, tanpa SELECT Signal.
* `CLICKHOUSE_READER_USERNAME` dan `CLICKHOUSE_READER_PASSWORD`: credential SELECT bagi logs dan jobs service.
* `CLICKHOUSE_MIGRATOR_USERNAME` dan `CLICKHOUSE_MIGRATOR_PASSWORD`: credential DDL yang hanya tersedia pada migration host.
* `CLICKHOUSE_TLS_CA_FILE`: CA bundle private jika bukan CA sistem.
* `OBSERVABILITY_SIGNAL_QUEUE_MAX_ITEMS`: default 20.000.
* `OBSERVABILITY_SIGNAL_QUEUE_MAX_BYTES`: default 33.554.432.
* `OBSERVABILITY_SIGNAL_BATCH_MAX_ITEMS`: default 5.000.
* `OBSERVABILITY_SIGNAL_BATCH_MAX_BYTES`: default 4.194.304.
* `OBSERVABILITY_SIGNAL_FLUSH_INTERVAL_MS`: default 500.
* `OBSERVABILITY_SIGNAL_MAX_IN_FLIGHT`: default 4.
* `OBSERVABILITY_SIGNAL_RETRY_LIMIT`: default 3.
* `OBSERVABILITY_SIGNAL_QUERY_MAX_CONCURRENCY`: default 8.

Exact ClickHouse patch disimpan sebagai file version manifest di `packages/observability`, bukan sebagai environment value.

**Critical test scenarios**:

* Happy path: satu request Elysia menghasilkan Span, Application Log, Access Log, dan Metric Bucket melalui deep module, lalu semua dapat dibaca serta dikorelasikan, memverifikasi **AC-1**, **AC-3**, **AC-4**, **AC-5**, dan **AC-13**.
* Durability boundary: kegagalan Signal storage membuang Signal setelah tiga retry dan membuka Blind Spot tanpa mengubah response bisnis, sedangkan kegagalan Audit Trail tetap terlihat, memverifikasi **AC-3** dan **AC-9**.
* Queue pressure: antrean mencapai item dan byte cap saat burst, reserve prioritas mempertahankan error, slow, dan access failure sebelum success Signal, serta memory tetap bounded, memverifikasi **AC-8**, **AC-9**, dan **AC-10**.
* Poison isolation: satu row invalid di antara row valid hanya membuang row invalid dan mencatat diagnostic tanpa mencetak payload, memverifikasi **AC-7**, **AC-9**, dan **AC-18**.
* Read behavior: cursor maju lalu mundur menghasilkan row yang sama, cursor dengan filter berbeda ditolak, list storage failure menghasilkan Blind Spot, dan detail expired menghasilkan 404, memverifikasi **AC-11** sampai **AC-15**.
* Health and alert: dua probe gagal membuat alert firing di PostgreSQL dan tiga probe sukses menyelesaikannya, sementara metric alert menjadi unknown, memverifikasi **AC-16** dan **AC-17**.
* Startup gate: versi, schema, atau setting ClickHouse salah membuat Signal store disabled dan deployment gate gagal tanpa membuat aplikasi business tidak ready, memverifikasi **AC-20**.
* Security: writer tidak dapat SELECT, reader tidak dapat INSERT, migrator tidak tersedia pada runtime, koneksi tanpa TLS ditolak, dan sensitive fixture tidak tersimpan, memverifikasi **AC-18**.
* Capacity: dataset retention penuh menerima steady rate dan burst sambil menjalankan query mix, memenuhi freshness, latency, disk, dan overhead gate, memverifikasi **AC-2**, **AC-10**, **AC-11**, **AC-15**, dan **AC-19**.
* Migration: dual write tujuh hari, backfill resume dari checkpoint, count serta deterministic sample cocok, reader cutover, rollback, dan read only window dibuktikan, memverifikasi **AC-20** sampai **AC-22**.
* Local infrastructure: script native memakai temporary data directory dan unit test tetap lulus tanpa ClickHouse, memverifikasi **AC-23**.

## Build plan

Build mengikuti Tracer Bullet. Slice pertama membuktikan satu Span dari producer sampai query ClickHouse sebelum menambah tiga Signal lain.

1. Bawa maju contract test typed telemetry, correlation, benchmark, permission, dan overhead dari 0014, lalu buat package `packages/observability` dengan fake serta PostgreSQL adapter di balik interface empat method, satisfies **AC-1**, **AC-2**, **AC-3**, dan **AC-4**.
2. Pin ClickHouse LTS `26.3.17.110`, buat native local runner, ordered migration runner, PostgreSQL schema history, role, dan tabel Span ClickHouse, lalu kirim satu Span end to end melalui direct HTTP adapter, satisfies **AC-5**, **AC-7**, **AC-8**, **AC-18**, **AC-20**, dan **AC-23**.
3. Tambahkan Metric Bucket, Application Log, dan Access Log beserta queue byte cap, priority reserve, batch, retry, deduplication token, poison isolation, TTL, dan diagnostics, satisfies **AC-3** sampai **AC-10**.
4. Pindahkan trace serta metric read path ke adapter ClickHouse, bangun projection yang dapat dibuat ulang, cursor, query semaphore, deadline, Blind Spot response, dan storage health endpoint, satisfies **AC-11**, **AC-13** sampai **AC-16**.
5. Pindahkan Application Log dan Access Log ke cursor read path tanpa exact count, pertahankan Audit Trail di PostgreSQL, lalu regenerasi OpenAPI, SDK, dan halaman web yang terdampak, satisfies **AC-3**, **AC-11** sampai **AC-15**.
6. Ubah jobs evaluator agar membaca Metric Bucket dari ClickHouse dan menulis alert state ke PostgreSQL. Tambahkan availability probe, disk alert, metric unknown behavior, dan security role proof, satisfies **AC-17** dan **AC-18**.
7. Siapkan native production profile, pinned version gate, TLS, firewall, encryption runbook, disk guard, system query log retention, dan node rebuild procedure, satisfies **AC-18**, **AC-19**, **AC-20**, dan **AC-23**.
8. Jalankan capacity test pada hardware yang sama dengan dataset retention penuh, steady load, burst, dan concurrent query mix. Tune hanya setting di balik interface sampai seluruh ingest, query, freshness, memory, disk, dan instrumentation gate lulus, satisfies **AC-2**, **AC-8**, **AC-10**, **AC-11**, **AC-15**, dan **AC-19**.
9. Tambahkan dual write state, `telemetry.signal_migration_runs`, idempotent daily backfill, parity report, feature flagged reader cutover, rollback, PostgreSQL shadow period, dan read only period, satisfies **AC-20**, **AC-21**, dan **AC-22**.
10. Jalankan full contract, integration, migration, capacity, security, OpenAPI, SDK, web, benchmark, progress, dan repository validation suite, satisfies **AC-1** sampai **AC-23**.

## Migration plan

**Strategy**: Strangler dengan feature configured writer dan reader.

**Phases**:

1. Extract PostgreSQL Signal adapter tanpa mengubah behavior produksi.
2. Tambahkan ClickHouse schema serta satu Span tracer thread, lalu perluas ke empat Signal.
3. Aktifkan `dual` sedikitnya tujuh hari sambil reader tetap PostgreSQL.
4. Backfill retention harian dari paling lama, lalu jalankan count, sample checksum, query parity, dan SLO gate.
5. Pindahkan reader ke ClickHouse. Pertahankan PostgreSQL shadow write tujuh hari.
6. Hentikan PostgreSQL Signal write, buat tabel lama read only selama 30 hari, lalu hapus hanya melalui migration terpisah.

**Rollback**: Sebelum shadow period selesai, set reader kembali ke `postgres` dan writer ke `dual`. Tidak diperlukan deployment code. Sesudah PostgreSQL write dihentikan, rollback read hanya dijamin selama tabel lama masih berada dalam read only window dan gap setelah penghentian dinyatakan sebagai Blind Spot.

**Risks**: Dual write dapat berbeda, backfill dapat mengganggu ingest, duplicate dapat terlihat sebelum merge, satu node dapat hilang total, dan query baru dapat menghabiskan resource. Checkpoint, resource cap, parity gate, read model versioning, disk guard, dan explicit Blind Spot membatasi dampaknya.

## Consequences

**Positive**:

* Append heavy Signal tidak lagi berbagi storage serta query plan dengan business data dan Control.
* Empat Signal memiliki retensi, sort key, dan query path yang sesuai pola waktunya.
* Producer hanya mempelajari satu interface kecil dan tidak terkunci ke client ClickHouse.
* Audit, benchmark interpretation, alert state, dan migration state tetap mendapat transaction serta constraint PostgreSQL.

**Negative and tradeoffs**:

* Tim harus mengoperasikan ClickHouse, TLS, disk, merge, schema migration, dan capacity gate sendiri.
* Satu node tanpa backup berarti kehilangan retention adalah keputusan sadar, bukan high availability.
* Direct HTTP adapter, deduplication, derived projection, dan dual write menambah kode yang harus diuji serta dirawat.
* Search path yang tidak cocok dengan sort key dapat mahal dan perlu ditolak atau didesain ulang.

**Neutral**:

* Benchmark baseline tetap di Git dan benchmark Control tetap di PostgreSQL.
* Existing public route tetap ada, tetapi Application Log dan Access Log berubah dari offset paging menjadi cursor.
* TTL bersifat eventual dan dapat lewat sampai empat jam.
* OpenTelemetry Collector tetap di luar keputusan ini. W3C trace context dipertahankan agar migrasi protokol di masa depan tetap mungkin.

## Follow-up

* [ ] `elysiajs` conventions belum dicatat dalam project context. Buat `apps/services/AGENTS.md` untuk plugin, lifecycle, schema, dan error conventions, lalu tambahkan satu pointer di root `AGENTS.md` sebelum implementasi.
* [ ] `codebase-design` conventions belum ada di root `AGENTS.md` bagian Rules. Vocabulary deep module, interface, seam, adapter, dan locality berlaku lintas repo dan sebaiknya dicatat sebelum implementasi.
* [ ] Setelah PostgreSQL Signal table melewati 30 hari read only, buat migration terpisah yang memverifikasi rollback window selesai sebelum drop.
* [ ] Tinjau managed ClickHouse, replication, dan backup ketika kehilangan retention tidak lagi dapat diterima atau ketika operasi satu node melebihi kapasitas tim.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
