# 0017. Adopt ClickHouse as the only Observability Signal store

**Date**: 2026-08-27
**Status**: In Progress

## Summary

Observability Signal disimpan hanya di ClickHouse. Audit Trail dan Observability Control tetap di PostgreSQL karena keduanya menentukan hasil bisnis dan memerlukan transaction. Tidak ada mode storage. Tidak ada dual write, backfill, promotion gate, atau adapter PostgreSQL untuk Signal, sehingga tidak ada jalan konfigurasi apa pun yang membuat dua storage Signal aktif bersamaan.

Perubahan dari revisi sebelumnya adalah pembatalan strangler migration. Signal yang sudah ada di PostgreSQL dinyatakan dapat dibuang, tabelnya dihapus, dan seluruh kode dual write dihapus dari repository. Yang tersisa untuk dibangun adalah satu jalur produksi, satu adapter, satu pembuktian kapasitas, dan satu penghapusan storage lama.

Spec ini menggantikan spec 0014. Kontrak telemetry, benchmark, korelasi, permission, dan batas overhead yang tidak terkait pilihan storage tetap dipertahankan di sini.

## Structure

* [Runtime and benchmark contracts](0017-runtime-benchmark-contracts.md) membawa maju kontrak typed telemetry, korelasi, sampling, benchmark, dan overhead dari spec 0014.
* [Signal storage](0017-signal-storage.md) menetapkan deep module, empat entity Signal, schema ClickHouse, antrean, batch, retry, retensi, dan Blind Spot.
* [Query and control](0017-query-control.md) menetapkan PostgreSQL Control, read model, cursor, batas query, health, alert, API, dan permission.
* [Operations and removal](0017-operations.md) menetapkan instalasi satu node, migrasi schema, gate startup, kapasitas, penghapusan storage Signal PostgreSQL, dan operasi produksi.

Kontrak lintas child berada di dokumen ini. Jika child berbeda dengan kontrak lintas child, dokumen ini yang berlaku.

## Requirements

**User stories**:

* Sebagai operator, saya ingin mencari Signal dalam jendela insiden dengan waktu respons yang terukur agar diagnosis tetap berguna ketika volume tumbuh besar.
* Sebagai pemilik proses bisnis, saya ingin Audit Trail dan Control tetap tepat serta transaksional agar kegagalan observability tidak mengubah hasil bisnis.
* Sebagai maintainer, saya ingin satu deep module menyembunyikan storage, antrean, retry, dan batching agar producer tidak mengetahui ClickHouse.
* Sebagai maintainer, saya ingin hanya ada satu implementasi storage Signal agar tidak ada mode, tidak ada jalur cadangan yang harus diuji, dan tidak ada konfigurasi yang dapat menyalakan dua storage sekaligus.

**Acceptance criteria**:

* **AC-1**: `#project/telemetry` tetap menjadi kontrak typed untuk context, span, dan metric. W3C `traceparent`, arti `requestId`, `correlationId`, `runtimeTraceId`, `runtimeSpanId`, sampling, dan aturan bahwa telemetry tidak boleh mengubah hasil bisnis tetap sesuai kontrak yang dibawa maju dari spec 0014.
* **AC-2**: Benchmark run, baseline Git, comparison, signed ingestion, alert, dan permission tetap berfungsi dengan hasil yang sama. Benchmark membuktikan overhead instrumentation pada latency `p95` dan CPU tidak lebih dari 5 persen serta RSS tidak lebih dari 10 persen. Gate ini terbuka sampai kalibrasi resmi 20 run pada runner terkendali menghasilkan baseline yang dapat dibandingkan; kegagalan comparison karena baseline drift tidak boleh dilaporkan sebagai lulus.
* **AC-3**: ClickHouse adalah satu satunya storage Observability Signal, yaitu Span, Metric Bucket, Application Log, dan Access Log. PostgreSQL tetap menyimpan `logs.audit_trails` dan seluruh Observability Control. Tidak ada business state atau Control yang dipindahkan ke ClickHouse.
* **AC-4**: `packages/observability` mengekspos satu interface `ObservabilitySignalStore` yang hanya memiliki `append`, `flush`, `shutdown`, dan `diagnostics`. Hanya dua implementasi ada, yaitu ClickHouse adapter untuk seluruh runtime dan fake untuk unit test. Tidak ada adapter PostgreSQL Signal, tidak ada dual target, tidak ada backfill, dan tidak ada promotion. Producer tidak mengimpor client, query, table name, atau error ClickHouse.
* **AC-5**: Database ClickHouse `observability` memiliki tabel `spans`, `metric_buckets`, `application_logs`, dan `access_logs`. Setiap tabel memakai partisi UTC harian, sort key yang ditetapkan child Signal, stable identity, `schema_version`, `ingested_at`, dan version field yang ditetapkan. Hubungan antarsignal bersifat logis tanpa foreign key.
* **AC-6**: TTL menghapus Span setelah 7 hari serta Metric Bucket, Application Log, dan Access Log setelah 30 hari. Tidak ada cold archive. Penghapusan boleh tertunda paling lama empat jam karena dijalankan saat merge dan tidak boleh ditampilkan sebagai retensi yang presisi sampai detik.
* **AC-7**: Waktu event disimpan sebagai `DateTime64` UTC, duration disimpan sebagai integer nanosecond dari monotonic clock, dan zona Asia Jakarta hanya dipakai saat display. Signal yang lebih tua dari retention atau lebih dari lima menit ke masa depan ditolak dengan diagnostic tanpa menggagalkan bisnis. Ukuran serialized Signal maksimal 4 KiB.
* **AC-8**: ClickHouse adapter menulis langsung lewat HTTP dengan `async_insert=1` dan `wait_for_async_insert=1`. Setiap process memiliki antrean maksimal 20.000 Signal atau 32 MiB, reserve prioritas 20 persen, batch maksimal 5.000 row atau 4 MiB, flush 500 ms, dan maksimal empat batch in flight.
* **AC-9**: Transient failure dicoba ulang maksimal tiga kali dengan exponential backoff dan jitter memakai insert token yang sama. Poison row diisolasi dengan pembelahan batch. Setelah retry habis, Signal dibuang, counter serta waktu mulai Blind Spot diperbarui, console diagnostic disanitasi, dan request, transaction, message, job, serta process aplikasi tetap berjalan.
* **AC-10**: Pada hardware produksi yang sama, sistem menerima 100 juta Signal per hari pada rata rata sekitar 1.158 row per detik dan burst 10 kali sekitar 11.574 row per detik. Ukuran rata rata pengujian 1 KiB dan maksimum 4 KiB. Signal yang diterima antrean dapat dicari dengan freshness `p95` paling lama lima detik.
* **AC-11**: Query Signal memenuhi latency `p95` paling lama dua detik untuk rentang sampai 24 jam dan lima detik untuk rentang lebih dari 24 jam sampai 30 hari pada dataset retention penuh. Default rentang adalah 24 jam dengan preset 15 menit, 1 jam, 6 jam, dan 24 jam. Rentang custom maksimum 30 hari.
* **AC-12**: List Application Log dan Access Log memakai keyset cursor dua arah serta mengembalikan `prevCursor`, `nextCursor`, jumlah row halaman ini, filter, options, dan `storageStatus` tanpa exact total. Audit Trail tetap memakai page, total, dan PostgreSQL. Trace list tetap memakai page size 50 dan Metric tetap memakai batas 200 series. Page size default 100 dan dibatasi maksimal 100.
* **AC-13**: Trace, Metric, Benchmark, Baseline, dan Alert API yang sudah ada mempertahankan contract spec 0016. Trace summary, filter options, dan projection Signal yang diturunkan dari empat tabel dapat dibangun ulang dan bukan sumber kebenaran baru.
* **AC-14**: Ketika Signal storage tidak dapat dibaca, list mengembalikan HTTP 200 dengan data kosong dan `storageStatus: blind_spot`, sedangkan detail mengembalikan 503. Cursor atau rentang invalid mengembalikan 422. Signal detail yang sudah lewat retention mengembalikan 404. Query yang ditolak karena concurrency mengembalikan 429 dengan `Retry-After`.
* **AC-15**: Setiap logs service instance membatasi delapan query Signal bersamaan. Hard deadline adalah lima detik untuk rentang sampai 24 jam dan sepuluh detik untuk rentang lebih panjang. Field query memakai allowlist dan seluruh value memakai parameter binding.
* **AC-16**: `GET /internal/observability/storage-health` tidak diproxy gateway, hanya tersedia di jaringan internal, dan memerlukan signed identity yang memiliki setidaknya satu permission observability. Respons memuat state, `blindSpotSince`, dropped count, queue depth, last acknowledged insert, schema version, dan alasan kegagalan yang disanitasi.
* **AC-17**: Jobs service memeriksa ClickHouse setiap 30 detik. System managed availability alert tersimpan di PostgreSQL, menjadi firing setelah dua kegagalan berurutan, dan resolved setelah tiga keberhasilan berurutan. Alert metric biasa menjadi unknown ketika Signal tidak dapat dibaca. Disk alert memakai ambang warning 70 persen, firing 80 persen, dan critical 90 persen.
* **AC-18**: Produksi memakai tiga credential terpisah untuk migrator, writer, dan reader, ditambah credential readiness terbatas untuk startup writer. Koneksi produksi memakai TLS pada jaringan privat, firewall hanya mengizinkan backend, logs service, jobs service, dan migration host yang perlu. Full disk encryption aktif. Token, cookie, authorization header, request body, SQL mentah, password, dan secret tidak pernah disimpan. ClickHouse query log aktif selama tujuh hari dan hanya dapat dibaca operator database.
* **AC-19**: Produksi berjalan pada satu node ClickHouse self hosted yang dipasang native sebagai systemd service pada Linux VM dengan local NVMe. Starting floor adalah 16 vCPU, RAM 64 GiB, dan NVMe 4 TiB. ClickHouse LTS `26.3.17.110` dipin untuk development, staging, serta production. Tidak ada backup untuk Signal apa pun, termasuk Application Log dan Access Log yang sebelumnya durable di PostgreSQL. Kehilangan node membangun storage kosong dan seluruh retention yang hilang dicatat sebagai Blind Spot. Maintenance terencana maksimal 30 menit tidak menghentikan aplikasi.
* **AC-20**: `packages/observability` memiliki Bun migration runner untuk ClickHouse dengan ordered migration, checksum, PostgreSQL history, dan drift detection. Startup memeriksa versi ClickHouse, database, table schema version, dan required settings. Ketidakcocokan version, database, schema, atau required setting membuat process menolak start karena itu adalah kesalahan deployment. ClickHouse yang hanya tidak dapat dihubungi tidak menolak start: process tetap ready, Signal store menjadi `blind_spot`, dan deployment gate terpisah tetap gagal.
* **AC-21**: Storage Signal PostgreSQL dihapus. Migration `0041`, `0042`, dan `0043` dihapus sebagai file karena tidak ada spec lain yang memakainya. Satu migration baru menghapus `logs.logging`, `logs.access_logs`, `telemetry.spans`, `telemetry.metric_buckets`, dan `telemetry.signal_migration_runs` beserta partisi turunannya, memperbarui helper partisi dan grant agar tidak lagi menyebut dua tabel log Signal, dan tidak menyentuh `logs.audit_trails` maupun `telemetry.signal_schema_migrations`.
* **AC-22**: Tidak ada kode atau konfigurasi mode yang tersisa. `OBSERVABILITY_SIGNAL_WRITE_MODE`, `OBSERVABILITY_SIGNAL_READ_MODE`, dan `OBSERVABILITY_SIGNAL_PROMOTION_REPORT_ID` dihapus dari schema config, `.env.example`, dan seluruh caller. Jika salah satu variabel itu masih terpasang, process menolak start dengan pesan yang menyebut variabel tersebut sudah dihapus, agar tidak ada operator yang percaya dual masih aktif. Script `observability:promotion:record`, `observability:promotion:activate`, `observability:postgres:legacy-write-policy`, `observability:backfill`, dan `observability:postgres:adapter-contract` dihapus bersama implementasinya.
* **AC-23**: Local development menjalankan native `clickhouse server` melalui script repo dengan temporary data directory dan versi yang dipin. Docker dan Docker Compose tidak dipakai. Unit test memakai fake tanpa ClickHouse aktif. Integration test yang memerlukan ClickHouse gagal dengan prerequisite yang jelas dan tidak diam diam memakai versi lain.

## Decision

**Chosen option**: Option 3, direct ClickHouse cutover tanpa dual write.

Jadikan ClickHouse satu satunya storage Observability Signal, buang Signal PostgreSQL yang ada, dan hapus seluruh mesin migrasi dual write dari repository. (basis: `CONTEXT.md`, [spec 0011](../0011-log-subsystem/index.md), keputusan engineer bahwa tidak ada Signal history yang perlu dipertahankan, [ClickHouse MergeTree documentation](https://clickhouse.com/docs/reference/engines/table-engines/mergetree-family/mergetree))

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
| PostgreSQL | Signal Schema Migration | target ID dan migration version | `applied_at` | Permanen |

Relation PostgreSQL yang dihapus oleh spec ini:

| Relation | Dibuat di | Cara hilang |
|---|---|---|
| `logs.logging` | `0010` | Migration drop baru, termasuk partisi turunan di schema `partition` |
| `logs.access_logs` | `0010` | Migration drop baru, termasuk partisi turunan di schema `partition` |
| `telemetry.spans` | `0026` | Migration drop baru |
| `telemetry.metric_buckets` | `0026` | Migration drop baru |
| `telemetry.signal_migration_runs` | `0040` | Migration drop baru, checkpoint backfill |
| `telemetry.signal_promotion_reports` | `0041` | File migration dihapus |
| `telemetry.signal_storage_activations` | `0042` | File migration dihapus |
| `telemetry.assert_signal_storage_activation_transition()` | `0042`, diganti di `0043` | Kedua file dihapus |

Field lengkap serta physical layout terdapat pada child Signal dan Control. Foreign key hanya dipakai di PostgreSQL. ClickHouse memakai hubungan logis melalui trace ID, span ID, request ID, correlation ID, service, resource, time, dan benchmark run ID.

**State transitions**:

* Tidak ada writer mode dan tidak ada reader mode. ClickHouse selalu menjadi target tulis dan sumber baca Signal.
* Signal storage: `disabled → available → blind_spot → available`. `disabled` hanya dipakai ketika configuration ClickHouse belum ada, misalnya `ENABLE_INFRASTRUCTURE=false`. Ketidakcocokan schema tidak lagi menghasilkan `disabled` karena process menolak start. Waktu mulai Blind Spot baru dibersihkan setelah successful ACK mencatat recovery.
* Availability alert: `pending → firing → resolved`, dengan `unknown` untuk evaluasi metric yang tidak memiliki Signal dapat dipercaya.
* Migration run: `pending → running → succeeded`, hanya untuk ClickHouse schema migration. Error permanen menghasilkan `failed` dan rerun memakai file serta checksum yang sama.

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

Tidak ada endpoint write publik untuk Signal. Producer memanggil interface in process. Tidak ada endpoint atau command untuk mengubah storage mode karena mode tidak ada.

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
| Startup gate | mismatch atau unreachable | Bounded readiness probe memakai credential readiness; mismatch menghentikan start, unreachable hanya membuka Blind Spot |
| Startup gate | pesan variabel yang dihapus | Daftar nama variabel mode yang dihapus, dicek terhadap environment saat parsing config |
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
| PostgreSQL removal | daftar relation dan partisi | Catalog query saat migration dijalankan, bukan daftar nama yang di hardcode, agar layout partisi aktual tidak diasumsikan |
| UI display | zona waktu | UTC value dari API yang diformat memakai Asia Jakarta di client |

**Key invariants**:

* Observability Signal boleh hilang setelah bounded retry. Audit Trail tidak boleh memakai jalur ini dan gagal secara terlihat bersama business mutation yang mewajibkannya.
* Ketiadaan Signal tidak pernah diartikan sebagai nol atau sehat. API dan alert harus menyatakan Blind Spot atau unknown.
* Hanya ada satu implementasi storage Signal untuk runtime. Menambah implementasi kedua memerlukan spec baru, bukan configuration flag.
* Satu batch hanya berisi satu signal kind dan satu schema version agar ClickHouse async buffer memiliki shape stabil.
* Retry mempertahankan row identity, write version, dan insert token. Duplicate fisik boleh ada sebelum merge, tetapi read model selalu memilih version terbaru.
* Stable key, sort key, TTL, dan event time tidak boleh berubah tanpa table version baru dan migration plan baru.
* `packages/telemetry` tetap memiliki context, sampling, dan metric aggregation. `packages/logger` tetap memiliki sanitization dan Audit Trail. `packages/observability` sendiri memiliki Signal records, queue policy, adapter ClickHouse, dan ClickHouse migrations.
* Derived projection dapat dihapus serta dibangun ulang dari empat canonical table dan tidak boleh mengendalikan business outcome.
* Kegagalan yang berasal dari deployment yang salah dihentikan saat start. Kegagalan yang berasal dari infrastruktur yang sedang mati tidak boleh menghentikan traffic bisnis.

**Security model**:

* ClickHouse migrator hanya memiliki DDL pada database `observability`. Writer hanya memiliki INSERT pada empat canonical table. Readiness hanya membaca metadata terbatas tanpa SELECT Signal. Reader hanya memiliki SELECT yang diperlukan pada canonical table, projection, dan system view yang diperlukan untuk health.
* Hanya service backend yang menghasilkan Signal. Logs service membaca Signal. Jobs service membaca metric serta health dan menulis Control ke PostgreSQL.
* ClickHouse tidak terekspos ke internet. Production wajib TLS, private network, firewall allowlist, secret dari environment, dan full disk encryption.
* Field actor, email, IP, session, dan user agent yang sudah diizinkan spec 0011 boleh disimpan selama retention. Sanitization yang ada tetap berlaku. Token, cookie, authorization header, body, SQL mentah, password, secret, dan payload sensitif dilarang mutlak.
* Semua query memakai parameter binding dan field allowlist. ClickHouse query log disimpan tujuh hari dan hanya operator database yang dapat membacanya.
* Migration penghapusan storage Signal PostgreSQL dijalankan memakai `DATABASE_MIGRATION_URL` dengan role `project_migrator` seperti migration lain. Tidak ada credential operator khusus dan tidak ada command runtime yang dapat menghapus tabel.
* Tidak ada compliance khusus yang dinyatakan. Audit Trail tetap strict dan tidak menjadi Observability Signal.

**Configuration required**:

* `CLICKHOUSE_URL`: HTTPS endpoint privat node.
* `CLICKHOUSE_WRITER_USERNAME` dan `CLICKHOUSE_WRITER_PASSWORD`: credential INSERT bagi backend.
* `CLICKHOUSE_READINESS_USERNAME` dan `CLICKHOUSE_READINESS_PASSWORD`: credential catalog terbatas bagi startup writer, tanpa SELECT Signal.
* `CLICKHOUSE_READER_USERNAME` dan `CLICKHOUSE_READER_PASSWORD`: credential SELECT bagi logs dan jobs service.
* `CLICKHOUSE_MIGRATOR_USERNAME` dan `CLICKHOUSE_MIGRATOR_PASSWORD`: credential DDL yang hanya tersedia pada migration host.
* `CLICKHOUSE_TLS_CA_FILE`: CA bundle private jika bukan CA sistem.
* `CLICKHOUSE_REQUEST_TIMEOUT_MS`: batas satu request HTTP, default 5.000.
* `OBSERVABILITY_SIGNAL_QUEUE_MAX_ITEMS`: default 20.000.
* `OBSERVABILITY_SIGNAL_QUEUE_MAX_BYTES`: default 33.554.432.
* `OBSERVABILITY_SIGNAL_BATCH_MAX_ITEMS`: default 5.000.
* `OBSERVABILITY_SIGNAL_BATCH_MAX_BYTES`: default 4.194.304.
* `OBSERVABILITY_SIGNAL_FLUSH_INTERVAL_MS`: default 500.
* `OBSERVABILITY_SIGNAL_MAX_IN_FLIGHT`: default 4.
* `OBSERVABILITY_SIGNAL_RETRY_LIMIT`: default 3.
* `OBSERVABILITY_SIGNAL_QUERY_MAX_CONCURRENCY`: default 8.

`OBSERVABILITY_DATABASE_URL` tetap ada karena setiap service memakainya sebagai koneksi Control dan telemetry PostgreSQL. Yang dihapus hanya aturan bahwa variabel itu wajib untuk mode Signal production non-baseline, karena mode tidak ada lagi.

Variabel yang dihapus dan wajib ditolak jika masih terpasang: `OBSERVABILITY_SIGNAL_WRITE_MODE`, `OBSERVABILITY_SIGNAL_READ_MODE`, `OBSERVABILITY_SIGNAL_PROMOTION_REPORT_ID`, `OBSERVABILITY_TELEMETRY_MIGRATION_URL`, `OBSERVABILITY_LOGS_MIGRATION_URL`, dan `OBSERVABILITY_MIGRATION_LOGIN`.

Exact ClickHouse patch disimpan sebagai file version manifest di `packages/observability`, bukan sebagai environment value.

**Critical test scenarios**:

* Happy path: satu request Elysia menghasilkan Span, Application Log, Access Log, dan Metric Bucket melalui deep module, lalu semua dapat dibaca serta dikorelasikan, memverifikasi **AC-1**, **AC-3**, **AC-4**, **AC-5**, dan **AC-13**.
* Durability boundary: kegagalan Signal storage membuang Signal setelah tiga retry dan membuka Blind Spot tanpa mengubah response bisnis, sedangkan kegagalan Audit Trail tetap terlihat, memverifikasi **AC-3** dan **AC-9**.
* Queue pressure: antrean mencapai item dan byte cap saat burst, reserve prioritas mempertahankan error, slow, dan access failure sebelum success Signal, serta memory tetap bounded, memverifikasi **AC-8**, **AC-9**, dan **AC-10**.
* Poison isolation: satu row invalid di antara row valid hanya membuang row invalid dan mencatat diagnostic tanpa mencetak payload, memverifikasi **AC-7**, **AC-9**, dan **AC-18**.
* Read behavior: cursor maju lalu mundur menghasilkan row yang sama, cursor dengan filter berbeda ditolak, list storage failure menghasilkan Blind Spot, dan detail expired menghasilkan 404, memverifikasi **AC-11** sampai **AC-15**.
* Health and alert: dua probe gagal membuat alert firing di PostgreSQL dan tiga probe sukses menyelesaikannya, sementara metric alert menjadi unknown, memverifikasi **AC-16** dan **AC-17**.
* Startup split: version, schema, database, atau setting yang salah membuat process menolak start dengan exit code gagal, sedangkan ClickHouse yang mati hanya membuat process ready dengan Blind Spot dan deployment gate gagal, memverifikasi **AC-20**.
* Removed configuration: environment yang masih memasang salah satu variabel mode membuat process menolak start dengan pesan yang menyebut variabel itu, memverifikasi **AC-22**.
* Single implementation: pencarian repository membuktikan tidak ada adapter PostgreSQL Signal, tidak ada dual target, tidak ada backfill, tidak ada promotion, dan tidak ada script yang dihapus, memverifikasi **AC-4** dan **AC-22**.
* Removal migration: migration drop menghapus empat relation Signal, checkpoint backfill, dan partisi turunannya, sementara `logs.audit_trails` tetap dapat ditulis dan dibaca serta `telemetry.signal_schema_migrations` tetap utuh; reset dan seed berjalan idempoten sesudahnya, memverifikasi **AC-21**.
* Security: writer tidak dapat SELECT, reader tidak dapat INSERT, migrator tidak tersedia pada runtime, koneksi tanpa TLS ditolak, dan sensitive fixture tidak tersimpan, memverifikasi **AC-18**.
* Capacity: dataset retention penuh menerima steady rate dan burst sambil menjalankan query mix, memenuhi freshness, latency, disk, dan overhead gate, memverifikasi **AC-2**, **AC-10**, **AC-11**, **AC-15**, dan **AC-19**.
* Local infrastructure: script native memakai temporary data directory, unit test lulus tanpa ClickHouse memakai fake, dan integration test tanpa binary yang dipin gagal dengan prerequisite yang jelas, memverifikasi **AC-23**.

## Build plan

Build mengikuti Tracer Bullet, tetapi threadnya sudah berdiri. Slice pertama menghapus percabangan mode agar jalur produksi menjadi satu, karena setiap slice sesudahnya lebih murah diuji tanpa mode kedua.

**AC-5**, **AC-6**, **AC-7**, **AC-9**, dan **AC-17** sudah dipenuhi oleh pekerjaan yang sudah terkirim, yaitu schema ClickHouse, TTL, aturan waktu dan ukuran, retry serta poison isolation, dan availability alert. Keduapuluh tiga criterion tetap menjadi kontrak, sehingga kelima criterion itu dilindungi sebagai regresi pada task 10 dan bukan dibangun ulang.

1. Hapus writer mode, reader mode, dan promotion dari `packages/config`, `packages/observability`, `apps/services/logs`, `apps/services/jobs`, dan seluruh caller. ClickHouse adapter menjadi satu satunya target tulis dan sumber baca. Tolak start ketika variabel mode yang dihapus masih terpasang, satisfies **AC-3**, **AC-4**, dan **AC-22**.
2. Hapus `postgres.ts`, `backfill*`, `promotion*`, dan test terkait dari `packages/observability`, sisakan ClickHouse adapter dan fake di balik interface empat method. Hapus script promotion, activation, legacy write policy, backfill, dan PostgreSQL adapter contract dari `package.json` beserta implementasinya, satisfies **AC-4** dan **AC-22**.
3. Pisahkan gate startup menjadi dua jalur: mismatch version, database, schema, atau required setting menolak start, sedangkan ClickHouse yang tidak dapat dihubungi tetap ready dengan Blind Spot dan menggagalkan deployment gate terpisah, satisfies **AC-20**.
4. Hapus percabangan read PostgreSQL Signal dari `logs.repository.ts` dan `observability.repository.ts`, sisakan reader ClickHouse dengan cursor, semaphore, deadline, Blind Spot response, dan storage health. Pertahankan query Audit Trail PostgreSQL apa adanya, lalu regenerasi OpenAPI dan SDK bila shape berubah, satisfies **AC-11** sampai **AC-16**.
5. Hapus file migration `0041`, `0042`, dan `0043`, lalu tambahkan satu migration yang menghapus `logs.logging`, `logs.access_logs`, `telemetry.spans`, `telemetry.metric_buckets`, dan `telemetry.signal_migration_runs` beserta partisi turunannya, memperbarui helper partisi serta grant, dan membuktikan `logs.audit_trails` tidak tersentuh. Jalankan reset, seed, dan idempotence check, satisfies **AC-21**.
6. Perbarui `.env.example`, dokumentasi runtime, dan `bun run doctor` agar menyebut ClickHouse sebagai prerequisite Signal lokal, dengan unit test tetap memakai fake, satisfies **AC-22** dan **AC-23**.
7. Kalibrasi ulang benchmark baseline pada runner terkendali dengan 20 run yang valid, lalu bandingkan overhead instrumentation terhadap baseline baru itu, satisfies **AC-1** dan **AC-2**.
8. Siapkan native production profile, pinned version gate, TLS, firewall, encryption runbook, disk guard, system query log retention, dan prosedur rebuild node tanpa backup, satisfies **AC-18**, **AC-19**, dan **AC-20**.
9. Jalankan capacity test pada hardware yang sama dengan dataset retention penuh, steady load, burst, dan concurrent query mix. Tune hanya setting di balik interface sampai seluruh ingest, query, freshness, memory, disk, dan instrumentation gate lulus, satisfies **AC-2**, **AC-8**, **AC-10**, **AC-11**, **AC-15**, dan **AC-19**.
10. Jalankan full contract, integration, removal, capacity, security, OpenAPI, SDK, web, benchmark, progress, dan repository validation suite. Regresi wajib membuktikan schema ClickHouse, TTL, aturan waktu dan ukuran, retry, poison isolation, dan availability alert tidak berubah, satisfies **AC-1** sampai **AC-23**, khususnya **AC-5**, **AC-6**, **AC-7**, **AC-9**, dan **AC-17**.

## Migration plan

**Strategy**: Direct cutover dengan penghapusan storage lama, tanpa dual write dan tanpa backfill.

**Phases**:

1. Satu jalur kode. Mode, promotion, backfill, dan adapter PostgreSQL Signal dihapus sehingga hanya ClickHouse yang tersisa di runtime.
2. Satu jalur baca. Percabangan read PostgreSQL Signal dihapus dari logs service, Audit Trail tetap PostgreSQL.
3. Satu penghapusan schema. File `0041` sampai `0043` dihapus, satu migration drop menghapus empat relation Signal dan checkpoint backfill.
4. Satu pembuktian. Kalibrasi baseline, lalu capacity test pada hardware produksi sebelum produksi bergantung pada node ini.

**Rollback**: Tidak ada rollback data. Setelah phase 3, Signal PostgreSQL tidak ada lagi dan tidak dapat dipulihkan. Rollback yang tersedia hanya rollback kode melalui revert commit, dan interval mana pun tanpa Signal tersimpan dinyatakan sebagai Blind Spot. Ini adalah konsekuensi yang diterima karena tidak ada Signal history yang dinilai perlu dipertahankan.

**Risks**: Penghapusan `logs.logging` dan `logs.access_logs` menyentuh migration yang dimiliki spec 0011 yang sudah shipped, sehingga helper partisi, grant, dan seed harus ikut diperiksa. Menghapus file `0041` sampai `0043` mengubah checksum history pada database yang sudah menerapkannya, sehingga database itu wajib direset. Satu node tanpa backup berarti kehilangan node menghapus seluruh log, span, dan metric retention sekaligus. Capacity yang belum terbukti tidak lagi memiliki storage cadangan untuk menampung kesalahan sizing. Migration drop yang memakai daftar nama tetap dapat melewatkan partisi, sehingga penghapusan wajib membaca catalog aktual.

## Consequences

**Positive**:

* Hanya ada satu jalur storage Signal yang perlu dibaca, diuji, dan dioperasikan. Sekitar 4.600 baris mesin dual write, backfill, promotion, dan activation hilang bersama surface pengujiannya.
* Tidak ada configuration yang dapat membuat dua storage Signal aktif, sehingga kelas kesalahan operasional itu hilang sepenuhnya.
* Append heavy Signal tidak lagi berbagi storage serta query plan dengan business data dan Control.
* Empat Signal memiliki retensi, sort key, dan query path yang sesuai pola waktunya.
* Audit, benchmark interpretation, alert state, dan migration history tetap mendapat transaction serta constraint PostgreSQL.
* Slice terakhir feature menjadi jauh lebih pendek: tidak ada tujuh hari shadow write, tidak ada backfill harian, tidak ada parity gate berlapis.

**Negative and tradeoffs**:

* Tidak ada bukti parity dan tidak ada rollback data. Kesalahan schema, sort key, atau adapter ditemukan ketika produksi sudah bergantung pada ClickHouse.
* Application Log dan Access Log kehilangan durability PostgreSQL yang selama ini dimiliki, dan sekarang hilang seluruhnya bila node hilang.
* Tim harus mengoperasikan ClickHouse, TLS, disk, merge, schema migration, dan capacity gate sendiri, tanpa storage kedua sebagai jaring.
* Development lokal memerlukan ClickHouse berjalan untuk melihat Signal sendiri.
* Signal history PostgreSQL yang ada dibuang, jadi jendela diagnosis sebelum cutover tidak dapat dipanggil kembali.

**Neutral**:

* Benchmark baseline tetap di Git dan benchmark Control tetap di PostgreSQL.
* Existing public route tetap ada, tetapi Application Log dan Access Log berubah dari offset paging menjadi cursor.
* TTL bersifat eventual dan dapat lewat sampai empat jam.
* OpenTelemetry Collector tetap di luar keputusan ini. W3C trace context dipertahankan agar migrasi protokol di masa depan tetap mungkin.
* Word hybrid tetap tepat untuk pemisahan Signal dan Control, tetapi nama spec dan feature memakai ClickHouse agar tidak terbaca sebagai dual storage.

## Follow-up

* [ ] `elysiajs` conventions belum dicatat dalam project context. Buat `apps/services/AGENTS.md` untuk plugin, lifecycle, schema, dan error conventions, lalu tambahkan satu pointer di root `AGENTS.md` sebelum implementasi.
* [ ] `codebase-design` conventions belum ada di root `AGENTS.md` bagian Rules. Vocabulary deep module, interface, seam, adapter, dan locality berlaku lintas repo dan sebaiknya dicatat sebelum implementasi.
* [ ] Spec 0011 masih menyatakan application log dan access log disimpan di PostgreSQL. Catatan pointer sudah ditambahkan, tetapi bagian storage spec itu perlu ditinjau ulang penuh saat feature ini selesai.
* [ ] Tinjau managed ClickHouse, replication, dan backup ketika kehilangan retention tidak lagi dapat diterima atau ketika operasi satu node melebihi kapasitas tim. Tanpa storage kedua, keputusan ini menjadi satu satunya pelindung retention.
* [ ] Setelah capacity test lulus, catat hasil sizing sebenarnya agar starting floor 16 vCPU, 64 GiB, dan 4 TiB tidak dipakai sebagai angka permanen tanpa bukti.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
