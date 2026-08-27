# 0017. Operations and removal

## Summary

ClickHouse berjalan sebagai satu native node yang murah dan sengaja tidak high availability. Tidak ada backup untuk Signal apa pun. Karena tidak ada storage kedua, kelayakan produksi bergantung pada pinned version, schema gate saat start, dan capacity test retention penuh pada hardware yang sama. Bagian terakhir dokumen ini menetapkan cara storage Signal PostgreSQL dihapus.

## Deployment profile

Production starting profile:

```text
Topology       one dedicated ClickHouse node
Operating OS   supported Linux distribution
Runtime        native clickhouse-server under systemd
CPU            16 vCPU minimum
Memory         64 GiB minimum
Data disk      4 TiB local NVMe minimum
Network        private only, TLS required
Version        LTS 26.3.17.110, exact patch pinned
Backup         none for any Observability Signal
```

Node tidak berbagi filesystem dengan PostgreSQL atau application process. ClickHouse data, temporary merge data, dan log memakai local NVMe dengan full disk encryption. OS, filesystem, mount option, open file limit, clock synchronization, systemd restart policy, dan TLS certificate menjadi versioned runbook.

Starting profile bukan capacity guarantee. Production hanya boleh memakai profile yang sama dengan successful capacity report atau profile yang lebih besar dan telah melalui smoke test yang sama.

Backup tidak ada untuk keempat Signal, termasuk Application Log dan Access Log yang sebelumnya durable di PostgreSQL. Konsekuensinya dinyatakan eksplisit: kehilangan node berarti kehilangan seluruh trace, metric, application log, dan access log yang masih dalam retention, sekaligus. Ini diterima karena Signal dipisahkan dari Audit Trail dan Control, dan Audit Trail tetap berada di PostgreSQL.

## Version pinning

ClickHouse LTS `26.3.17.110` direkam pada `packages/observability/clickhouse-version.json` bersama artifact checksum serta supported schema range. Development, staging, capacity host, dan production memakai exact patch itu.

Upgrade mengikuti urutan:

1. Pin patch baru serta checksum dalam pull request.
2. Jalankan migration compatibility, adapter integration, query behavior, dan capacity smoke pada staging dengan production schema serta retained fixture.
3. Jadwalkan single node maintenance maksimal 30 menit.
4. Upgrade binary, jalankan schema check, lalu buka Signal intake.
5. Jika check gagal, backend menolak start dan operator memperbaiki binary atau migration sebelum deploy dilanjutkan.

Automatic major atau minor upgrade dilarang. Binary downgrade hanya dilakukan jika ClickHouse menyatakan data format compatible dan staging rehearsal lulus. Jika tidak, recovery membuat node kosong pada pinned known good version.

## Local development

Root script `bun run observability:clickhouse:local` menjalankan pinned native `clickhouse server` dengan configuration repo serta temporary data directory yang dibuat secara aman. Script mencetak endpoint nonsecret, menunggu bounded readiness, menjalankan migration bila diminta, dan membersihkan temporary process serta directory pada exit normal.

Docker dan Docker Compose tidak digunakan.

ClickHouse adalah prerequisite untuk melihat Signal secara lokal. Tanpa ClickHouse berjalan, backend tetap start dan tetap melayani request, tetapi Signal store berada pada `blind_spot` dan developer tidak melihat trace, metric, application log, maupun access log miliknya sendiri. Ini disengaja: satu jalur produksi lebih penting daripada kenyamanan lokal, dan adapter kedua tidak dipertahankan hanya untuk development.

Unit test memakai fake dan tidak memerlukan ClickHouse. Integration test yang membutuhkan ClickHouse gagal dengan clear prerequisite ketika pinned binary tidak tersedia dan tidak diam diam memakai versi lain. `ENABLE_INFRASTRUCTURE=false` membuat Signal store `disabled` tanpa mencoba menghubungi ClickHouse.

## Migration ownership and format

`packages/observability` memiliki:

```text
clickhouse-version.json
migrations/clickhouse/NNNN_name.sql
src/migrations/*
scripts/start-local-clickhouse.ts
```

ClickHouse migration bersifat ordered, immutable, forward only, dan checksum protected. DDL ClickHouse tidak dianggap transaction lintas statement. Setiap file memakai idempotent precondition serta postcondition. History PostgreSQL hanya ditulis setelah seluruh postcondition lulus.

Migration runner memerlukan PostgreSQL Control connection dan ClickHouse migrator credential. Ia mengambil PostgreSQL advisory lock agar hanya satu runner aktif, memeriksa exact binary version, membandingkan version serta checksum history, menjalankan pending file berurutan, memeriksa table engine, partition expression, sort key, TTL, settings, role grants, dan schema version, lalu mencatat execution time.

Partial DDL tidak mendapat success history. Rerun dengan file dan checksum sama harus menyelesaikan idempotently. Repair yang mengubah intent memakai migration version baru dan tidak mengedit file yang pernah sukses.

## Startup and deployment gates

Setiap process yang memakai Signal store memeriksa secara bounded:

* ClickHouse reachable dengan TLS.
* Binary version berada pada exact supported patch.
* Database `observability` ada.
* Empat canonical table memiliki supported schema version, engine, sort key, partition, serta TTL.
* Async insert, wait, deduplication window, readonly profile, dan role grant yang diperlukan aktif.

Hasil check dipisah menjadi dua kelas, karena asal kegagalannya berbeda.

**Deployment mismatch menolak start.** Binary version di luar supported patch, database `observability` tidak ada, table schema version tidak didukung, engine, sort key, partisi, atau TTL tidak cocok, dan required setting tidak aktif adalah kesalahan deployment. Process keluar dengan exit code gagal dan pesan yang menyebut check mana yang gagal. Tidak ada Blind Spot untuk kelas ini, karena tidak ada process yang berjalan.

**ClickHouse yang tidak dapat dihubungi tetap membiarkan process start.** Connection refused, DNS gagal, TLS handshake gagal karena endpoint mati, dan timeout adalah kegagalan infrastruktur. Process tetap ready dan tetap melayani business traffic, Signal store menjadi `blind_spot`, `append` menghasilkan dropped reason, dan health melaporkan alasan yang disanitasi. Deployment verification terpisah tetap wajib gagal sampai Signal readiness available, dan benchmark readiness juga tetap gagal.

Pemisahan ini menjaga aturan `CONTEXT.md` bahwa masalah Signal tidak mengubah hasil bisnis untuk kegagalan yang benar benar berasal dari infrastruktur, sementara kesalahan konfigurasi tetap ditemukan sebelum traffic masuk. Sebuah ClickHouse yang mati tidak boleh membuat setiap restart gagal atau mengosongkan fleet saat rolling restart.

**Configuration yang dihapus juga menolak start.** Jika environment masih memasang `OBSERVABILITY_SIGNAL_WRITE_MODE`, `OBSERVABILITY_SIGNAL_READ_MODE`, `OBSERVABILITY_SIGNAL_PROMOTION_REPORT_ID`, `OBSERVABILITY_TELEMETRY_MIGRATION_URL`, `OBSERVABILITY_LOGS_MIGRATION_URL`, atau `OBSERVABILITY_MIGRATION_LOGIN`, config parsing gagal dengan pesan yang menyebut nama variabel itu dan menyatakan variabel tersebut sudah dihapus. Mengabaikannya diam diam akan membuat operator percaya dual write masih aktif padahal kodenya tidak ada lagi.

Tidak ada tabel mode. Tidak ada writer mode, reader mode, atau kombinasi yang valid, karena ClickHouse selalu menjadi target tulis dan sumber baca Signal.

## Capacity qualification

Capacity test berjalan pada production hardware serta exact binary, schema, setting, TLS, dan role profile. Test artifact merekam Git commit, version manifest checksum, hardware, filesystem, ClickHouse setting, workload manifest, query mix, disk state, dan result.

Karena tidak ada dual write, backfill, atau storage kedua, capacity test adalah satu satunya bukti sebelum produksi bergantung pada node ini. Ia wajib lulus sebelum feature dinyatakan selesai, dan kegagalannya tidak boleh diselesaikan dengan menurunkan SLO.

### Dataset

* Tujuh hari Span dan 30 hari Metric Bucket, Application Log, serta Access Log sudah ada sebelum measurement.
* Total retained row serta compressed bytes berasal dari versioned fixture manifest.
* Payload rata rata 1 KiB dan maksimum 4 KiB setelah serialization.
* Initial mixed fixture adalah 60 persen Span, 20 persen Metric Bucket, 15 persen Access Log, dan 5 persen Application Log. Angka ini adalah conservative capacity fixture, bukan klaim traffic produksi. Per entity stress scenario juga dijalankan agar satu kind yang dominan tidak tersembunyi oleh mix.

### Load phases

1. Warmup sampai merge, cache, dan async buffer stabil.
2. Steady ingest 60 menit pada total 100 juta row per hari, sekitar 1.158 row per detik.
3. Burst ingest 15 menit pada 10 kali rate, sekitar 11.574 row per detik.
4. Recovery 30 menit pada steady rate untuk membuktikan queue kembali normal dan merge debt turun.

Concurrent query mix mencakup 24 hour Signal list, 7 day trace search serta detail, 30 day application dan access search, 30 day metric aggregation, filter options, dan jobs alert evaluation. Setiap query class memiliki cukup observation untuk stable `p95`, paling sedikit 200 successful samples.

### Passing gates

* Batch acceptance paling sedikit 99,9 persen dari batch yang diterima local queue.
* Searchable freshness `p95` maksimal lima detik.
* Query latency `p95` maksimal dua detik untuk sampai 24 jam dan lima detik untuk range lebih panjang.
* Tidak ada unbounded queue, out of memory, process crash, merge backlog yang terus naik setelah recovery, atau sensitive diagnostic.
* Instrumentation journey serta throughput tetap dalam 5 persen latency `p95` serta CPU dan 10 persen RSS, dibandingkan terhadap baseline yang sudah dikalibrasi ulang.
* Projected compressed retained bytes ditambah 30 persen merge headroom tidak memakai lebih dari 80 persen total disk. Sedikitnya 20 persen disk tetap bebas.
* Availability, disk, dan Blind Spot alert bertransisi dengan benar di bawah injected failure.

Capacity gagal jika satu gate gagal. Tuning boleh mengubah codec, index granularity, reader memory, threads, async buffer, atau derived projection di balik contract. Stable identity, sort key order, retention, public SLO, dan loss semantics memerlukan spec change jika hendak diubah.

### Benchmark baseline calibration

Perbandingan overhead terakhir gagal karena baseline drift, bukan regresi nyata. Replay dari commit sebelum hybrid pada host yang sama menghasilkan angka yang cocok dengan run hybrid dan berbeda dari artifact yang disetujui. Karena itu kalibrasi resmi 20 run pada runner terkendali wajib dijalankan lebih dahulu, dengan syarat cukup Tukey inlier, CV per metric di bawah batas, dan event loop `p95` dalam batas. Sebelum baseline baru itu ada, gate overhead dilaporkan terbuka dan tidak boleh dinyatakan lulus.

## PostgreSQL Signal storage removal

Penghapusan memakai dua mekanisme berbeda karena asal tabelnya berbeda.

**File migration yang dihapus.** `0041_telemetry_signal_promotion_reports`, `0042_telemetry_signal_storage_activations`, dan `0043_telemetry_signal_storage_rollback_blind_spot` hanya membuat promotion report, activation ledger, dan trigger transisinya. Tidak ada spec lain yang memakainya, sehingga file up dan down dihapus dan database yang sudah menerapkannya direset. Fungsi `telemetry.assert_signal_promotion_report_immutable()` dan `telemetry.assert_signal_storage_activation_transition()` hilang bersama file itu.

**Satu migration drop ke depan.** Empat relation Signal dan checkpoint backfill lahir di file yang juga membuat relation yang harus tetap ada, sehingga filenya tidak boleh diedit:

| Relation yang dihapus | Lahir di | Relation yang harus tetap ada di file yang sama |
|---|---|---|
| `logs.logging` | `0010_logs_partitioned_tables` | `logs.audit_trails` |
| `logs.access_logs` | `0010_logs_partitioned_tables` | `logs.audit_trails` |
| `telemetry.spans` | `0026_telemetry_foundation` | benchmark run, baseline, comparison, alert state, ingestion receipt |
| `telemetry.metric_buckets` | `0026_telemetry_foundation` | benchmark run, baseline, comparison, alert state, ingestion receipt |
| `telemetry.signal_migration_runs` | `0040_telemetry_signal_control` | `telemetry.signal_schema_migrations` |

Migration drop wajib:

1. Membaca catalog aktual untuk menemukan setiap partisi turunan dari `logs.logging` dan `logs.access_logs`, bukan memakai daftar nama tahun yang di hardcode. Layout partisi produksi tidak boleh diasumsikan.
2. Menghapus parent beserta seluruh descendant di schema `partition`.
3. Menghapus `telemetry.spans` dan `telemetry.metric_buckets` beserta partisi harian serta cleanup function yang hanya melayani keduanya, termasuk yang dibuat `0034` dan `0035`.
4. Menghapus `telemetry.signal_migration_runs`.
5. Memperbarui helper partisi bersama di `packages/database` dan daftar tabel pada seeder atau grant yang menyebut `logging` serta `access_logs`, sehingga tidak ada kode yang mencoba membuat partisi untuk tabel yang sudah tidak ada.
6. Tidak menyentuh `logs.audit_trails`, partisinya, ownership `project_logs_writer` atasnya, `CREATE` pada schema `partition` yang masih dibutuhkan Audit Trail, dan `telemetry.signal_schema_migrations`.

Migration dijalankan memakai `DATABASE_MIGRATION_URL` dengan role `project_migrator` seperti migration lain. Tidak ada credential operator khusus, tidak ada advisory lock tambahan, dan tidak ada command runtime yang dapat menghapus tabel. Down migration tidak mengembalikan data, hanya struktur kosong jika memang dibuat.

Setelah migration diterapkan, `bun run db:reset --confirm --seed` dan idempotence check wajib hijau, dan tidak ada query aplikasi yang masih menyebut lima relation itu.

**Script yang dihapus** bersama implementasinya: `observability:promotion:record`, `observability:promotion:activate`, `observability:postgres:legacy-write-policy`, `observability:backfill`, dan `observability:postgres:adapter-contract`. Tidak ada perintah operator yang mengubah storage mode, karena mode tidak ada.

## Single node failure and maintenance

Planned maintenance maksimal 30 menit. Application tetap menerima business traffic. Queue tetap bounded dan boleh drop setelah cap atau retry. Seluruh kehilangan dicatat sebagai Blind Spot. Maintenance lebih lama menjadi incident dan memicu availability alert.

Node loss recovery:

1. Availability alert tetap firing di PostgreSQL.
2. Provision dedicated VM dengan pinned binary, TLS, disk encryption, dan network policy.
3. Jalankan ClickHouse migration runner sampai schema gate lulus.
4. Buka writer serta reader pada database kosong.
5. Record missing interval sebagai Blind Spot. Tidak ada restore, tidak ada cold archive, dan tidak ada storage lain yang menyimpan interval itu.

Kehilangan node adalah kehilangan seluruh retention. Tidak ada langkah pemulihan sebagian, karena PostgreSQL tidak lagi menyimpan Signal.

Disk guard memberi warning 70 persen, incident policy pada 80 persen, dan critical pada 90 persen. TTL merge dapat dipicu atau ditune, tetapi operator tidak melakukan unbounded mutation saat incident.

## Secrets and audit

Migrator credential hanya ada pada migration host dan tidak masuk runtime environment. Writer, readiness, reader, serta TLS secrets dapat dirotasi dengan membuat credential baru, deploy caller, membuktikan successful access, lalu revoke credential lama. Secret tidak masuk version control atau diagnostic.

ClickHouse system query log aktif tujuh hari untuk database operators. Migration execution, credential rotation, maintenance, node rebuild, dan penghapusan tabel Signal PostgreSQL menghasilkan strict PostgreSQL Audit Trail dengan actor, reason, time, dan safe result.

## Rationale

Native single node dipilih karena engineer menerima availability serta retention loss tradeoff dan ingin operasi awal tetap kecil. Capacity gate membuat hardware floor menjadi hypothesis yang bisa ditolak, bukan angka pemasaran, dan tanpa storage kedua ia menjadi satu satunya bukti sebelum produksi.

Gate startup dipisah karena mencampur dua kelas kegagalan menghasilkan pilihan yang buruk di kedua arah. Menolak start untuk semuanya membuat outage ClickHouse menjadi outage aplikasi dan mengosongkan fleet saat rolling restart. Membiarkan semuanya start membuat deployment yang salah konfigurasi berjalan diam diam dengan Blind Spot yang tidak dibaca siapa pun. Memisahkannya membuat masing masing mendapat perlakuan yang tepat.

Penghapusan memakai file delete untuk `0041` sampai `0043` dan forward migration untuk sisanya karena mengedit `0010`, `0026`, dan `0040` berarti menulis ulang applied history spec 0011 dan 0014 yang sudah shipped, mengubah checksum, dan menyentuh helper partisi, grant, serta seed. Satu migration ke depan lebih murah, lebih jujur, dan bekerja pada database yang sudah menerapkan migration lama.
