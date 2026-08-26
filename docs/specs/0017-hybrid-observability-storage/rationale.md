# 0017. Hybrid observability storage decision record

This file holds the reasoning behind [index.md](index.md). Builds read the index and child specs. This file is for people reviewing the decision later.

## Context

> ⚠️ Premise note: 100 juta row per hari adalah design envelope yang dipilih, bukan volume produksi yang sudah diukur. Tidak ada sumber resmi yang menjamin envelope itu pada satu node dengan hardware yang dipilih. ClickHouse hanya layak dipromosikan setelah capacity test pada hardware dan dataset retention yang sama lulus. Satu node tanpa backup juga tidak dapat disebut durable observability. Framing yang jujur adalah storage Signal berkapasitas tinggi dengan kehilangan yang diterima dan Blind Spot yang terlihat, bukan pengganti Audit Trail atau business control.

Monobungsia saat ini menyimpan application log, access log, audit trail, span, metric bucket, benchmark projection, ingestion receipt, dan alert state di PostgreSQL. Application serta access log memakai antrean process local yang best effort. Audit Trail ditunggu dan gagal secara terlihat. Telemetry mengagregasi metric, melakukan sampling span, lalu menulis batch PostgreSQL langsung dari `packages/telemetry`.

Desain lama sudah terbukti pada benchmark instrumentation, tetapi repository tidak memiliki bukti volume produksi mendekati 100 juta row per hari. PostgreSQL telemetry juga berbagi failure domain dengan Control dan business data. Daily partition telah menghasilkan ribuan partition, sementara query Signal dan maintenance retention akan terus bertambah seiring volume.

Perubahan harus mempertahankan public route, permission, korelasi, benchmark reproducibility, dan rule bahwa telemetry tidak mengubah business outcome. Audit Trail dan Control memerlukan constraint, transaction, dan exact state. Signal bersifat append oriented serta boleh hilang setelah bounded retry. Perbedaan semantik inilah yang menjadi seam, bukan sekadar pilihan database.

## Current state evidence

* `packages/telemetry/src/index.ts` memiliki typed context, sampling, metric aggregation, antrean, retry, dan SQL PostgreSQL dalam satu implementation.
* `packages/logger/src/activity-log.ts` memisahkan best effort Application Log serta Access Log dari strict Audit Trail, tetapi ketiganya masih memakai PostgreSQL.
* `apps/services/logs/src/modules/observability/observability.repository.ts` mencampur public query behavior, cursor, timeout, projection, dan SQL PostgreSQL dalam satu repository besar.
* Migration `0026`, `0034`, dan `0035` membuat Span serta Metric Bucket terpartisi harian dengan cleanup function. Spec 0014 mencatat PostgreSQL outage sebagai Blind Spot.
* Spec 0016 sudah menetapkan per signal permissions, keyset cursor untuk observability list, missing metric yang bukan nol, dan halaman operator yang harus dipertahankan.
* Verification 0014 membuktikan instrumentation overhead, bukan throughput storage pada envelope baru.

## Options considered

### Option 1: Improve PostgreSQL in place

Pertahankan seluruh data di PostgreSQL, lalu tune partition, index, retention, connection pool, dan query. Declarative partitioning dapat memberi pruning, locality, bulk load, dan penghapusan partition yang murah jika jumlah partition tetap terkendali. (basis: current repository stack, [PostgreSQL declarative partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html))

**Pros**:

* Tidak menambah database, credential, migration runner, atau operating knowledge.
* Transaction, constraint, backup, dan query tooling sudah dikenal tim.
* Perubahan aplikasi paling kecil.

**Cons**:

* Signal tetap berbagi CPU, disk, connection, maintenance, dan failure domain dengan Control.
* 100 juta row per hari membuat index, partition planning, vacuum, dan retention menjadi beban utama yang belum dibuktikan repository.
* Query analytics rentang waktu besar tetap bersaing dengan write workload.

### Option 2: Hybrid storage with strangler migration

Simpan empat Signal di ClickHouse, pertahankan Audit Trail serta Control di PostgreSQL, dan pindahkan melalui deep module, dual write, backfill, parity gate, serta feature configured cutover. MergeTree menulis immutable parts dan mengatur locality melalui sort key, sehingga cocok dengan append heavy time range queries. (basis: domain split di `CONTEXT.md`, strangler pattern, [ClickHouse MergeTree documentation](https://clickhouse.com/docs/reference/engines/table-engines/mergetree-family/mergetree), [ClickHouse observability engineering](https://clickhouse.com/resources/engineering/observability))

**Pros**:

* Signal mendapat columnar compression, time range scan, TTL, dan physical ordering yang sesuai query operator.
* Control mempertahankan transaction, foreign key, unique constraint, dan exact state PostgreSQL.
* Dual write dan reader flag memberi bukti serta rollback sebelum storage lama dihentikan.
* Satu interface menyembunyikan adapter dan mengurangi pengetahuan storage pada producer.

**Cons**:

* Tim mengoperasikan database kedua, direct HTTP adapter, schema runner, TLS, disk, dan capacity test.
* Eventual merge berarti duplicate fisik dan TTL dapat terlihat sementara.
* Satu node tanpa backup menerima kehilangan retention secara eksplisit.

### Option 3: Direct ClickHouse cutover

Buat schema ClickHouse lalu pindahkan writer dan reader pada satu maintenance window tanpa dual write atau retained backfill. Target akhirnya sama dengan Option 2, tetapi migration path jauh lebih pendek. (basis: direct replacement alternative, current storage contracts)

**Pros**:

* Tidak ada periode dua storage, parity machinery, atau shadow write panjang.
* Waktu implementasi dan temporary storage cost lebih kecil.

**Cons**:

* Tidak ada bukti field parity, query parity, atau throughput sebelum blast radius penuh.
* Rollback kehilangan Signal yang hanya ditulis ke ClickHouse.
* Kesalahan schema, sort key, atau adapter baru ditemukan ketika production sudah bergantung padanya.

## Rationale

Option 2 dipilih karena semantik data memang terbagi. Signal bersifat append oriented, boleh hilang, dan dibaca melalui agregasi rentang waktu. Audit Trail serta Control menentukan accountability, benchmark interpretation, authorization evidence, replay protection, migration progress, dan alert transition. Memindahkan semuanya ke satu analytics store akan mengorbankan constraint yang dibutuhkan Control. Mempertahankan semuanya di PostgreSQL akan mempertahankan failure domain dan operational pressure yang ingin dihilangkan.

ClickHouse bukan dipilih karena popularitas. Design envelope 100 juta row per hari, retention sampai 30 hari, dan query time range memberi alasan teknis yang PostgreSQL saat ini belum buktikan. MergeTree memberi immutable part serta sort key locality, sedangkan native TTL menghapus atau merollup data saat merge. Karena TTL tidak berjalan tepat pada expiry, spec menerima delay maksimal empat jam dan tidak menjanjikan deletion deadline presisi. (basis: [ClickHouse MergeTree documentation](https://clickhouse.com/docs/reference/engines/table-engines/mergetree-family/mergetree), [ClickHouse TTL documentation](https://clickhouse.com/docs/concepts/features/operations/delete/ttl))

Strangler migration dipilih di atas cutover langsung karena storage baru, adapter baru, dan single node baru memiliki blast radius besar. Tujuh hari dual write, retained backfill, deterministic sample, query parity, dan reader flag memberi bukti sebelum bergantung pada ClickHouse. PostgreSQL shadow write selama tujuh hari sesudah reader cutover memberi rollback tanpa code deployment. (basis: strangler pattern for live migrations, feature flags for significant changes)

Direct HTTP dipilih karena engineer menetapkannya dan karena interface deep module dapat menyembunyikan transport. Production menggunakan `async_insert=1` serta `wait_for_async_insert=1`, sehingga ACK baru diterima setelah buffer berhasil flush ke disk dan error flush kembali ke adapter. Mode tanpa wait tidak dipakai karena dapat mengakui data yang belum durable. ClickHouse memiliki client resmi untuk Node.js, tetapi dokumentasi yang diperiksa tidak menyatakan kompatibilitas Bun. Adapter berbasis Bun `fetch` menghindari menjadikan kompatibilitas yang tidak dijamin sebagai dependency produksi. (basis: [ClickHouse asynchronous inserts](https://clickhouse.com/docs/concepts/features/operations/insert/asyncinserts), [ClickHouse Node.js integration](https://clickhouse.com/integrations/nodejs))

ClickHouse LTS `26.3.17.110` dipin untuk build ini. Branch 26.2 masih memenuhi feature minimum lama, tetapi saat keputusan dibuat sudah tidak menerima security update. LTS menjadi pilihan karena single node pertama memerlukan cadence upgrade yang lebih tenang daripada stable reguler. Stable `26.7.3.19` adalah runner up ketika team siap mengikuti upgrade lebih sering. (basis: [ClickHouse security support](https://github.com/ClickHouse/ClickHouse/security), [ClickHouse official packages](https://packages.clickhouse.com/))

Deep module `ObservabilitySignalStore` dipilih agar producer hanya memahami accepted atau dropped, flush, shutdown, serta diagnostics. Antrean, batch, retry, token, HTTP, dan SQL berada di belakang seam. PostgreSQL adapter membuat extraction dapat dikirim tanpa behavior change. ClickHouse adapter kedua membuat seam nyata dan dapat diuji melalui satu contract suite. (basis: `codebase-design` skill, deletion test, one adapter is hypothetical and two adapters make a real seam)

Elysia lifecycle, W3C context, resource name, sampling, benchmark, dan permission dibawa maju. Storage migration tidak menjadi alasan untuk mengganti instrumentation contract atau public product behavior yang sudah diverifikasi. (basis: [spec 0014](../0014-bun-observability-benchmarking/index.md), [spec 0016](../0016-observability-per-signal-pages/index.md), `elysiajs` skill, [Elysia documentation index](https://elysiajs.com/llms.txt), [Elysia OpenTelemetry pattern](https://elysiajs.com/patterns/opentelemetry.md), [Elysia OpenTelemetry plugin](https://elysiajs.com/plugins/opentelemetry.md))

## Capacity interpretation

Envelope bukan forecast bisnis. Ia adalah gate desain berikut:

* Average 100.000.000 row per 24 jam, sekitar 1.158 row per detik.
* Burst 10 kali, sekitar 11.574 row per detik, diuji selama 15 menit setelah steady load 60 menit.
* Payload rata rata 1 KiB dan maksimum 4 KiB dengan campuran empat Signal yang mewakili produksi.
* Dataset awal berisi retention penuh, yaitu tujuh hari Span dan 30 hari untuk tiga Signal lain.
* Concurrent read mix menjalankan list, detail trace, metric range, filter option, application search, dan access search selama ingest.
* Disk lulus jika projected compressed retained bytes ditambah 30 persen merge headroom tetap menyisakan sedikitnya 20 persen total disk bebas.

Starting floor 16 vCPU, 64 GiB RAM, dan 4 TiB NVMe bukan sizing guarantee. Jika floor gagal, implementasi tidak boleh menurunkan SLO atau mengklaim production ready. Tim harus memperbaiki schema atau query, menaikkan hardware, atau merevisi envelope melalui spec baru. ClickHouse learning material resmi menempatkan schema design, ingestion, query acceleration, dan scaling sebagai satu rangkaian, sehingga capacity gate harus menguji semuanya bersama. (basis: [ClickHouse observability learning path](https://clickhouse.com/learn/observability), measure before optimisation)

## Tool discovery record

Engineer menolak pencarian serta pemasangan ClickHouse Agent Skill dan MCP. Tidak ada plugin atau skill tambahan yang dipasang. Keputusan serta implementasi mengandalkan source repository, official ClickHouse documentation, Elysia documentation index, contract tests, dan capacity tests.

## References

**Project sources**:

* `CONTEXT.md`, definisi Observability Signal, Observability Control, Audit Trail, dan Blind Spot.
* [Spec 0011](../0011-log-subsystem/index.md), strict Audit Trail, best effort log, sanitization, correlation, dan permission behavior.
* [Spec 0014](../0014-bun-observability-benchmarking/index.md), typed telemetry, benchmark, alert, overhead, dan PostgreSQL storage yang diganti.
* [Spec 0016](../0016-observability-per-signal-pages/index.md), per signal permission, cursor, options, completeness, dan operator pages.
* `packages/telemetry`, `packages/logger`, `apps/services/logs`, serta migration `0026`, `0034`, dan `0035`, current writer, reader, schema, partition, serta retention implementation.
* `elysiajs` dan `codebase-design` skills, Elysia lifecycle serta deep module vocabulary.

**Practices and standards**:

* Strangler pattern untuk live migration.
* Feature configured cutover dan rollback.
* Deep module deletion test serta contract test lintas adapter.
* Bounded retry dengan stable idempotency token.
* Keyset pagination untuk growing time ordered data.
* Least privilege database roles.
* Measure before optimisation.

**Links**:

* ClickHouse MergeTree: https://clickhouse.com/docs/reference/engines/table-engines/mergetree-family/mergetree
* ClickHouse TTL: https://clickhouse.com/docs/concepts/features/operations/delete/ttl
* ClickHouse asynchronous inserts: https://clickhouse.com/docs/concepts/features/operations/insert/asyncinserts
* ClickHouse Node.js integration: https://clickhouse.com/integrations/nodejs
* ClickHouse observability engineering: https://clickhouse.com/resources/engineering/observability
* ClickHouse observability learning path: https://clickhouse.com/learn/observability
* PostgreSQL declarative partitioning: https://www.postgresql.org/docs/current/ddl-partitioning.html
* Elysia documentation index: https://elysiajs.com/llms.txt
* Elysia OpenTelemetry pattern: https://elysiajs.com/patterns/opentelemetry.md
* Elysia OpenTelemetry plugin: https://elysiajs.com/plugins/opentelemetry.md
