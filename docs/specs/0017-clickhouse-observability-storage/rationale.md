# 0017. ClickHouse only observability storage decision record

This file holds the reasoning behind [index.md](index.md). Builds read the index and child specs. This file is for people reviewing the decision later.

## Context

> ⚠️ Premise note: 100 juta row per hari adalah design envelope yang dipilih, bukan volume produksi yang sudah diukur. Tidak ada sumber resmi yang menjamin envelope itu pada satu node dengan hardware yang dipilih. ClickHouse hanya layak dipromosikan setelah capacity test pada hardware dan dataset retention yang sama lulus. Satu node tanpa backup juga tidak dapat disebut durable observability. Framing yang jujur adalah storage Signal berkapasitas tinggi dengan kehilangan yang diterima dan Blind Spot yang terlihat, bukan pengganti Audit Trail atau business control.

> ⚠️ Premise note kedua, ditambahkan pada revisi 2026-08-27: menghapus dual write juga menghapus satu satunya mekanisme yang membuktikan ClickHouse benar sebelum produksi bergantung padanya. Dengan tidak adanya parity gate, capacity test menjadi satu satunya bukti sebelum cutover, sehingga ia berubah dari gate yang baik menjadi gate yang wajib. Application Log dan Access Log juga kehilangan durability PostgreSQL yang selama ini mereka miliki. Keduanya adalah harga yang dibayar untuk kesederhanaan, dan keduanya diterima secara sadar oleh engineer.

Monobungsia saat ini menyimpan application log, access log, audit trail, span, metric bucket, benchmark projection, ingestion receipt, dan alert state di PostgreSQL. Application serta access log memakai antrean process local yang best effort. Audit Trail ditunggu dan gagal secara terlihat. Telemetry mengagregasi metric, melakukan sampling span, lalu menulis batch PostgreSQL langsung dari `packages/telemetry`.

Desain lama sudah terbukti pada benchmark instrumentation, tetapi repository tidak memiliki bukti volume produksi mendekati 100 juta row per hari. PostgreSQL telemetry juga berbagi failure domain dengan Control dan business data. Daily partition telah menghasilkan ribuan partition, sementara query Signal dan maintenance retention akan terus bertambah seiring volume.

Revisi awal spec ini memilih strangler migration: dual write, backfill harian, parity gate, promotion report, activation ledger, reader cutover, shadow window, lalu retirement tertunda. Mesin itu sudah dibangun dan diuji, dan biayanya sekarang terukur, bukan lagi perkiraan. Sekitar 4.600 baris berada di `backfill*`, `promotion*`, `postgres.ts`, dan percabangan mode di `store.ts`, `configured.ts`, `runtime.ts`, serta `reader.ts`, ditambah tiga migration Control, lima script operator, empat variabel environment, dan percabangan read di dua repository logs service. Slice terakhir feature juga belum selesai, dan yang tersisa persis adalah bagian dual write, backfill, cutover, serta rollback itu.

Pada saat yang sama, dua fakta membuat mesin tersebut kehilangan alasan keberadaannya. Tidak ada Signal history di PostgreSQL yang dinilai perlu dipertahankan, dan repository belum memiliki deployment produksi, hanya CI. Strangler pattern melindungi data produksi yang sedang berjalan. Ketika tidak ada data produksi yang dilindungi, yang tersisa hanya biayanya.

Perubahan harus mempertahankan public route, permission, korelasi, benchmark reproducibility, dan rule bahwa telemetry tidak mengubah business outcome. Audit Trail dan Control memerlukan constraint, transaction, dan exact state. Signal bersifat append oriented serta boleh hilang setelah bounded retry. Perbedaan semantik inilah yang menjadi seam, bukan sekadar pilihan database.

## Current state evidence

* `packages/observability/src` memiliki 26 file dan sekitar 9.300 baris. Dari jumlah itu, `backfill-adapters.ts`, `backfill.ts`, `backfill-control-postgres.ts`, `promotion.ts`, `promotion-control-postgres.ts`, dan `postgres.ts` beserta testnya adalah mesin migrasi, bukan jalur produksi akhir.
* `packages/config/src/index.ts` memvalidasi empat kombinasi mode writer dan reader, dan mewajibkan promotion report ID untuk mode production non-baseline.
* `apps/services/logs/src/modules/logs/logs.repository.ts` dan `.../observability/observability.repository.ts` keduanya bercabang pada `readMode`, dengan default `postgres`, sehingga setiap read path punya dua implementasi.
* Migration `0041`, `0042`, dan `0043` membuat promotion report, activation ledger, dan trigger transisinya. Tidak ada spec selain revisi sebelumnya yang memakainya.
* `logs.logging` dan `logs.access_logs` lahir di `0010` bersama `logs.audit_trails`. `telemetry.spans` dan `telemetry.metric_buckets` lahir di `0026` bersama benchmark, alert, dan ingestion Control. `telemetry.signal_migration_runs` lahir di `0040` bersama `telemetry.signal_schema_migrations`. Karena itu penghapusan tidak dapat dilakukan hanya dengan menghapus file migration.
* `docs/specs/0017-.../verify.md` revisi sebelumnya menandai lima item terbuka, dan empat di antaranya adalah backfill, parity, cutover, dan rollback.
* Verification 0014 membuktikan instrumentation overhead, bukan throughput storage pada envelope baru. Perbandingan overhead terakhir gagal karena baseline drift, bukan karena regresi nyata, dan masih menunggu kalibrasi 20 run pada runner terkendali.
* Spec 0016 sudah menetapkan per signal permissions, keyset cursor untuk observability list, missing metric yang bukan nol, dan halaman operator yang harus dipertahankan.

## Options considered

### Option 1: Improve PostgreSQL in place

Pertahankan seluruh data di PostgreSQL, lalu tune partition, index, retention, connection pool, dan query. Declarative partitioning dapat memberi pruning, locality, bulk load, dan penghapusan partition yang murah jika jumlah partition tetap terkendali. (basis: current repository stack, [PostgreSQL declarative partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html))

**Pros**:

* Tidak menambah database, credential, migration runner, atau operating knowledge.
* Transaction, constraint, backup, dan query tooling sudah dikenal tim.
* Application Log dan Access Log tetap durable dan tetap ikut backup PostgreSQL.
* Perubahan aplikasi paling kecil, dan pekerjaan ClickHouse yang sudah dibangun tidak terpakai.

**Cons**:

* Signal tetap berbagi CPU, disk, connection, maintenance, dan failure domain dengan Control.
* 100 juta row per hari membuat index, partition planning, vacuum, dan retention menjadi beban utama yang belum dibuktikan repository.
* Query analytics rentang waktu besar tetap bersaing dengan write workload.
* Membuang investasi ClickHouse yang sudah lulus schema, adapter, dan contract test.

### Option 2: Hybrid storage with strangler migration

Simpan empat Signal di ClickHouse, pertahankan Audit Trail serta Control di PostgreSQL, dan pindahkan melalui deep module, dual write, backfill, parity gate, serta feature configured cutover. Ini adalah keputusan revisi sebelumnya. (basis: domain split di `CONTEXT.md`, strangler pattern, [ClickHouse MergeTree documentation](https://clickhouse.com/docs/reference/engines/table-engines/mergetree-family/mergetree), [ClickHouse observability engineering](https://clickhouse.com/resources/engineering/observability))

**Pros**:

* Signal mendapat columnar compression, time range scan, TTL, dan physical ordering yang sesuai query operator.
* Dual write dan reader flag memberi bukti field parity, query parity, dan throughput sebelum blast radius penuh.
* Rollback tersedia tanpa deployment kode selama shadow window.
* Mesinnya sudah dibangun, sehingga jalan ini adalah yang paling dekat dengan keadaan repository sekarang.

**Cons**:

* Dua implementasi storage Signal hidup bersamaan, dan setiap read path punya dua cabang yang harus diuji.
* Sekitar 4.600 baris kode ada hanya untuk perpindahan, lalu harus dihapus lagi setelah cutover.
* Empat variabel environment dan lima script operator membuat konfigurasi produksi dapat salah dengan cara yang tidak terlihat.
* Melindungi data produksi yang tidak ada, karena belum ada deployment dan tidak ada Signal history yang perlu dipertahankan.
* Menunda penyelesaian feature paling sedikit dua minggu untuk shadow window dan backfill.

### Option 3: Direct ClickHouse cutover

Jadikan ClickHouse satu satunya storage Signal sekarang, buang Signal PostgreSQL yang ada, dan hapus seluruh mesin dual write dari repository. Target akhirnya sama dengan Option 2, tetapi tanpa periode dua storage. (basis: keputusan engineer bahwa tidak ada Signal history yang perlu dipertahankan, tidak adanya deployment produksi, deletion test pada deep module)

**Pros**:

* Satu implementasi, satu jalur baca, satu jalur tulis. Tidak ada mode yang dapat dikonfigurasi salah.
* Sekitar 4.600 baris hilang bersama surface pengujiannya, dan slice terakhir feature menjadi pendek.
* Target akhir dicapai langsung, tanpa kode transisi yang harus dibangun lalu dihapus.
* Konsisten dengan semantik Signal: data yang boleh hilang tidak memerlukan migrasi yang melindungi setiap row.

**Cons**:

* Tidak ada bukti field parity, query parity, atau throughput sebelum produksi bergantung penuh pada ClickHouse.
* Rollback kehilangan Signal karena tidak ada storage kedua dan tidak ada backup.
* Kesalahan schema, sort key, atau adapter baru ditemukan ketika produksi sudah bergantung padanya.
* Application Log dan Access Log kehilangan durability yang selama ini dimiliki di PostgreSQL.
* Signal history PostgreSQL yang ada hilang permanen.

## Rationale

Option 3 dipilih karena alasan keberadaan Option 2 tidak lagi berlaku. Strangler pattern adalah jawaban yang benar ketika sistem produksi sedang berjalan dan datanya harus tetap hidup selama perpindahan. Repository ini tidak memiliki deployment produksi, hanya CI, dan engineer menyatakan tidak ada Signal history di PostgreSQL yang perlu dipertahankan. Ketika tidak ada data yang dilindungi, dual write hanya menambah satu implementasi kedua, dua cabang pada setiap read path, empat variabel environment, lima script operator, dan sekitar 4.600 baris yang nanti harus dihapus lagi. Biaya itu bukan lagi perkiraan, karena mesinnya sudah dibangun dan dapat dihitung.

Revisi sebelumnya menolak Option 3 dengan alasan blast radius, dan alasan itu tetap benar. Yang berubah bukan penilaian risikonya, melainkan apa yang berada dalam radius tersebut. Tanpa produksi dan tanpa history, radiusnya adalah kemampuan diagnosis di masa depan, bukan data yang sudah ada. Karena itu spec ini tidak berpura pura risikonya hilang. Ia memindahkan seluruh beban pembuktian ke satu tempat: capacity test pada hardware dan dataset retention yang sama, yang sekarang menjadi gate wajib dan bukan lagi tambahan. Kalibrasi baseline benchmark juga dinaikkan menjadi langkah build tersendiri, karena perbandingan overhead yang terakhir gagal akibat baseline drift dan gate yang tidak dapat dipercaya tidak melindungi apa pun.

Pemisahan Signal dan Control tetap dipertahankan, dan itulah sebabnya keputusan ini bukan sekadar mengganti database. Signal bersifat append oriented, boleh hilang, dan dibaca melalui agregasi rentang waktu. Audit Trail serta Control menentukan accountability, benchmark interpretation, authorization evidence, replay protection, dan alert transition. Memindahkan semuanya ke satu analytics store akan mengorbankan constraint yang dibutuhkan Control. Mempertahankan semuanya di PostgreSQL akan mempertahankan failure domain dan operational pressure yang ingin dihilangkan. (basis: `CONTEXT.md`, [ClickHouse MergeTree documentation](https://clickhouse.com/docs/reference/engines/table-engines/mergetree-family/mergetree), [ClickHouse TTL documentation](https://clickhouse.com/docs/concepts/features/operations/delete/ttl))

Gate startup dipisah menjadi dua jalur karena dua kegagalan itu berbeda asal. Version, database, schema, dan required setting yang tidak cocok adalah kesalahan deployment, dan menolak start adalah cara termurah menemukannya sebelum traffic masuk. ClickHouse yang sedang mati adalah kegagalan infrastruktur, dan menolak start di situ akan membuat setiap restart gagal selama outage serta mengosongkan fleet saat rolling restart. Engineer awalnya memilih menolak start untuk keduanya; setelah asimetri antara boot dan runtime ditunjukkan, pemisahan ini yang dipilih. Aturan di `CONTEXT.md` bahwa masalah Signal tidak boleh mengubah hasil bisnis tetap utuh untuk kelas kegagalan yang benar benar berasal dari infrastruktur. (basis: `CONTEXT.md`, fail fast pada kesalahan konfigurasi, availability untuk kegagalan dependency)

Variabel environment yang dihapus wajib ditolak jika masih terpasang, bukan diabaikan diam diam. Config yang mengabaikan `OBSERVABILITY_SIGNAL_WRITE_MODE=dual` akan membuat operator percaya dual masih aktif padahal kodenya sudah tidak ada, dan itu adalah kelas kesalahan yang paling mahal ketika terjadi saat insiden. Runner up adalah memvalidasi lalu hanya mencatat peringatan, tetapi peringatan pada startup jarang dibaca. (basis: fail fast pada konfigurasi yang tidak lagi berlaku)

Penghapusan schema memakai dua mekanisme berbeda karena asal tabelnya berbeda. Migration `0041` sampai `0043` hanya berisi promotion dan activation, tidak ada spec lain yang memakainya, sehingga menghapus filenya lalu reset adalah cara paling bersih. Empat relation Signal dan checkpoint backfill lahir di file yang juga membuat relation yang harus tetap ada, yaitu `logs.audit_trails` di `0010`, benchmark serta alert Control di `0026`, dan `telemetry.signal_schema_migrations` di `0040`. Mengedit ketiga file itu berarti menulis ulang applied history spec 0011 dan 0014 yang sudah shipped, mengubah checksum, dan menyentuh helper partisi, grant, serta seed. Satu migration drop ke depan lebih murah dan lebih jujur. Migration itu juga wajib membaca catalog aktual, bukan daftar nama partisi yang di hardcode. (basis: forward only migration, [PostgreSQL declarative partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html))

Direct HTTP dipilih karena engineer menetapkannya dan karena interface deep module dapat menyembunyikan transport. Production menggunakan `async_insert=1` serta `wait_for_async_insert=1`, sehingga ACK baru diterima setelah buffer berhasil flush ke disk dan error flush kembali ke adapter. Mode tanpa wait tidak dipakai karena dapat mengakui data yang belum durable. ClickHouse memiliki client resmi untuk Node.js, tetapi dokumentasi yang diperiksa tidak menyatakan kompatibilitas Bun. Adapter berbasis Bun `fetch` menghindari menjadikan kompatibilitas yang tidak dijamin sebagai dependency produksi. (basis: [ClickHouse asynchronous inserts](https://clickhouse.com/docs/concepts/features/operations/insert/asyncinserts), [ClickHouse Node.js integration](https://clickhouse.com/integrations/nodejs))

ClickHouse LTS `26.3.17.110` dipin untuk build ini. Branch 26.2 masih memenuhi feature minimum lama, tetapi saat keputusan dibuat sudah tidak menerima security update. LTS menjadi pilihan karena single node pertama memerlukan cadence upgrade yang lebih tenang daripada stable reguler. Stable `26.7.3.19` adalah runner up ketika team siap mengikuti upgrade lebih sering. (basis: [ClickHouse security support](https://github.com/ClickHouse/ClickHouse/security), [ClickHouse official packages](https://packages.clickhouse.com/))

Deep module `ObservabilitySignalStore` tetap dipertahankan meskipun sekarang hanya ada satu adapter runtime. Interface empat method itulah yang membuat penghapusan adapter PostgreSQL menjadi pekerjaan satu paket, bukan pekerjaan lintas seluruh producer, dan itu adalah bukti langsung bahwa seam nya benar. Fake untuk unit test tetap menjadi implementasi kedua, sehingga contract suite masih menguji interface dan bukan implementasi tunggal. (basis: `codebase-design` skill, deletion test)

Elysia lifecycle, W3C context, resource name, sampling, benchmark, dan permission dibawa maju. Perubahan storage tidak menjadi alasan untuk mengganti instrumentation contract atau public product behavior yang sudah diverifikasi. (basis: [spec 0014](../0014-bun-observability-benchmarking/index.md), [spec 0016](../0016-observability-per-signal-pages/index.md), `elysiajs` skill, [Elysia documentation index](https://elysiajs.com/llms.txt), [Elysia OpenTelemetry pattern](https://elysiajs.com/patterns/opentelemetry.md), [Elysia OpenTelemetry plugin](https://elysiajs.com/plugins/opentelemetry.md))

## Capacity interpretation

Envelope bukan forecast bisnis. Ia adalah gate desain berikut:

* Average 100.000.000 row per 24 jam, sekitar 1.158 row per detik.
* Burst 10 kali, sekitar 11.574 row per detik, diuji selama 15 menit setelah steady load 60 menit.
* Payload rata rata 1 KiB dan maksimum 4 KiB dengan campuran empat Signal yang mewakili produksi.
* Dataset awal berisi retention penuh, yaitu tujuh hari Span dan 30 hari untuk tiga Signal lain.
* Concurrent read mix menjalankan list, detail trace, metric range, filter option, application search, dan access search selama ingest.
* Disk lulus jika projected compressed retained bytes ditambah 30 persen merge headroom tetap menyisakan sedikitnya 20 persen total disk bebas.

Starting floor 16 vCPU, 64 GiB RAM, dan 4 TiB NVMe bukan sizing guarantee. Karena tidak ada lagi storage kedua yang dapat menampung kesalahan sizing, kegagalan capacity gate tidak boleh diselesaikan dengan menurunkan SLO atau mengklaim production ready. Tim harus memperbaiki schema atau query, menaikkan hardware, atau merevisi envelope melalui spec baru. ClickHouse learning material resmi menempatkan schema design, ingestion, query acceleration, dan scaling sebagai satu rangkaian, sehingga capacity gate harus menguji semuanya bersama. (basis: [ClickHouse observability learning path](https://clickhouse.com/learn/observability), measure before optimisation)

## Removed migration machinery inventory

Daftar ini adalah bukti biaya yang dibicarakan pada Rationale, dan sekaligus checklist penghapusan.

| Artifact | Lokasi | Alasan hilang |
|---|---|---|
| Backfill engine dan adapter | `packages/observability/src/backfill.ts`, `backfill-adapters.ts`, `backfill-control-postgres.ts` dan testnya | Tidak ada data yang dipindahkan |
| Promotion gate dan Control | `packages/observability/src/promotion.ts`, `promotion-control-postgres.ts` dan testnya | Tidak ada promotion antar storage |
| PostgreSQL Signal adapter | `packages/observability/src/postgres.ts` dan testnya | Bukan lagi target tulis atau baca |
| Mode resolution | `packages/observability/src/configured.ts`, `runtime.ts`, `store.ts` bagian dual | Mode tidak ada |
| Mode validation | `packages/config/src/index.ts` | Mode tidak ada, variabel ditolak jika terpasang |
| Read branching | `apps/services/logs/src/modules/logs/logs.repository.ts`, `.../observability/observability.repository.ts` | Reader ClickHouse menjadi satu satunya jalur Signal |
| Operator script | `observability:promotion:record`, `observability:promotion:activate`, `observability:postgres:legacy-write-policy`, `observability:backfill`, `observability:postgres:adapter-contract` | Tidak ada cutover, lock, atau adapter kedua |
| Control migration | `0041`, `0042`, `0043` | File dihapus, tidak ada spec lain yang memakainya |
| Signal relation PostgreSQL | `logs.logging`, `logs.access_logs`, `telemetry.spans`, `telemetry.metric_buckets`, `telemetry.signal_migration_runs` | Migration drop baru |

## Tool discovery record

Engineer menolak pencarian serta pemasangan ClickHouse Agent Skill dan MCP. Tidak ada plugin atau skill tambahan yang dipasang. Keputusan serta implementasi mengandalkan source repository, official ClickHouse documentation, Elysia documentation index, contract tests, dan capacity tests.

## References

**Project sources**:

* `CONTEXT.md`, definisi Observability Signal, Observability Control, Audit Trail, dan Blind Spot.
* [Spec 0011](../0011-log-subsystem/index.md), strict Audit Trail, best effort log, sanitization, correlation, dan permission behavior.
* [Spec 0014](../0014-bun-observability-benchmarking/index.md), typed telemetry, benchmark, alert, overhead, dan PostgreSQL storage yang diganti.
* [Spec 0016](../0016-observability-per-signal-pages/index.md), per signal permission, cursor, options, completeness, dan operator pages.
* `packages/observability`, `packages/config`, `packages/telemetry`, `packages/logger`, `apps/services/logs`, serta migration `0010`, `0026`, `0040`, `0041`, `0042`, dan `0043`, current writer, reader, mode, schema, partition, serta retention implementation.
* `verify.md` revisi sebelumnya, bukti bahwa item terbuka adalah backfill, parity, cutover, dan rollback.
* `elysiajs` dan `codebase-design` skills, Elysia lifecycle serta deep module vocabulary.

**Practices and standards**:

* Deep module deletion test serta contract test lintas implementasi.
* Fail fast pada kesalahan konfigurasi, availability untuk kegagalan dependency.
* Forward only migration untuk penghapusan schema pada file yang dimiliki spec lain.
* Bounded retry dengan stable idempotency token.
* Keyset pagination untuk growing time ordered data.
* Least privilege database roles.
* Measure before optimisation, dan gate kapasitas sebagai satu satunya bukti ketika tidak ada storage cadangan.

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
