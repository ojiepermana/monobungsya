# 0017. Cutover and operations

## Summary

ClickHouse berjalan sebagai satu native node yang murah dan sengaja tidak high availability. Production promotion bergantung pada pinned version, schema gate, full retention capacity test, dan disk headroom. Migrasi memakai dual write, retained backfill, parity gate, reader cutover, rollback window, lalu retirement PostgreSQL yang tertunda.

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
Backup         none for Observability Signal
```

Node tidak berbagi filesystem dengan PostgreSQL atau application process. ClickHouse data, temporary merge data, dan log memakai local NVMe dengan full disk encryption. OS, filesystem, mount option, open file limit, clock synchronization, systemd restart policy, dan TLS certificate menjadi versioned runbook.

Starting profile bukan capacity guarantee. Production hanya boleh memakai profile yang sama dengan successful capacity report atau profile yang lebih besar dan telah melalui smoke test yang sama.

## Version pinning

Sebelum migration pertama dibuat, ClickHouse LTS `26.3.17.110` direkam pada `packages/observability/clickhouse-version.json` bersama artifact checksum serta supported schema range. Development, staging, capacity host, dan production memakai exact patch itu.

Upgrade mengikuti urutan:

1. Pin patch baru serta checksum dalam pull request.
2. Jalankan migration compatibility, adapter integration, query parity, dan capacity smoke pada staging dengan production schema serta retained fixture.
3. Jadwalkan single node maintenance maksimal 30 menit.
4. Upgrade binary, jalankan schema check, lalu buka Signal intake.
5. Jika check gagal, Signal store tetap disabled dan Blind Spot berlanjut sampai binary atau migration diperbaiki.

Automatic major atau minor upgrade dilarang. Binary downgrade hanya dilakukan jika ClickHouse menyatakan data format compatible dan staging rehearsal lulus. Jika tidak, recovery membuat node kosong pada pinned known good version.

## Local development

Root script menjalankan pinned native `clickhouse server` dengan configuration repo serta temporary data directory yang dibuat secara aman. Script mencetak endpoint nonsecret, menunggu bounded readiness, menjalankan migration bila diminta, dan membersihkan temporary process serta directory pada exit normal.

Docker dan Docker Compose tidak digunakan. Developer yang tidak memerlukan integration test dapat menjalankan unit test melalui fake atau PostgreSQL adapter tanpa ClickHouse. Integration test yang membutuhkan ClickHouse gagal dengan clear prerequisite ketika pinned binary tidak tersedia dan tidak diam diam memakai versi lain.

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

Kegagalan check membuat Signal store `disabled`, `append` menghasilkan dropped reason, dan health membuka Blind Spot. Business readiness tetap ready agar observability outage tidak menjadi application outage. Deployment verification terpisah wajib gagal sampai Signal readiness available. Benchmark readiness juga tetap gagal.

Allowed configuration states:

| Write mode | Read mode | Meaning |
|---|---|---|
| `postgres` | `postgres` | Extraction selesai, behavior lama |
| `dual` | `postgres` | Shadow write serta backfill |
| `dual` | `clickhouse` | Reader cutover dengan rollback shadow |
| `clickhouse` | `clickhouse` | Final target |

Combination lain invalid dan menggagalkan configuration validation. Mode tidak berubah otomatis karena failure. Operator mengubahnya melalui versioned deployment configuration.

## Dual write behavior

Dual mode memakai satu canonical queue. Ketika batch sealed, immutable row set dikirim ke PostgreSQL adapter dan ClickHouse adapter dengan independent result serta diagnostic. `append` berarti local queue menerima row dan tidak menjanjikan kedua store sudah menulis.

Selama reader masih PostgreSQL, kegagalan ClickHouse tidak mengubah public read tetapi menurunkan parity serta membuka target Blind Spot. Selama reader ClickHouse dan PostgreSQL menjadi shadow, kegagalan PostgreSQL tidak mengubah Signal read tetapi menutup rollback completeness. Keduanya tidak mengubah business outcome.

Per adapter batch ledger process local merekam batch ID, kind, count, attempt, ACK time, dan safe error code. Aggregate promotion evidence disimpan pada migration report di PostgreSQL tanpa row payload.

## Backfill

Backfill hanya membaca retained PostgreSQL Signal. Satu run memproses satu signal kind dan satu UTC day, dimulai dari day tertua:

1. Buat atau resume `telemetry.signal_migration_runs`.
2. Baca source dalam stable order event time dan stable ID dengan bounded page.
3. Ubah ke canonical schema version target tanpa mengubah event time atau identity.
4. Tulis batch ClickHouse memakai deterministic token dari signal kind, source day, schema version, dan page boundary.
5. Simpan checkpoint hanya setelah ClickHouse acknowledged write.
6. Setelah range selesai, bandingkan latest identity count serta deterministic sample checksum.
7. Tandai succeeded hanya ketika validation lulus.

Sample memilih row dengan stable ID hash modulo 1.000 sama dengan nol. Range dengan kurang dari 1.000 row memeriksa seluruh row. Canonical sample hash mencakup setiap public field setelah type normalization dan tidak mencakup `ingested_at` atau write version. Source dan target aggregate checksum harus identik 100 persen.

Backfill memakai dedicated query setting dengan maksimal 30 persen CPU thread budget, memory budget, serta measured disk write bandwidth node. Ia auto pause jika salah satu kondisi terjadi:

* Signal freshness `p95` melewati lima detik.
* Query SLO gagal dalam dua consecutive measurement windows.
* Disk usage mencapai 80 persen.
* Queue pressure menghasilkan drop.
* ClickHouse availability atau schema health tidak available.

Resume memerlukan guard hijau dan memakai committed cursor. Backfill tidak mengambil priority reserve writer.

## Capacity qualification

Capacity test berjalan pada production hardware serta exact binary, schema, setting, TLS, dan role profile. Test artifact merekam Git commit, version manifest checksum, hardware, filesystem, ClickHouse setting, workload manifest, query mix, disk state, dan result.

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

Concurrent query mix mencakup 24 hour Signal list, 7 day trace search serta detail, 30 day application dan access search, 30 day metric aggregation, filter options, and jobs alert evaluation. Setiap query class memiliki cukup observation untuk stable `p95`, paling sedikit 200 successful samples.

### Passing gates

* Batch acceptance paling sedikit 99,9 persen dari batch yang diterima local queue.
* Searchable freshness `p95` maksimal lima detik.
* Query latency `p95` maksimal dua detik untuk sampai 24 jam dan lima detik untuk range lebih panjang.
* Tidak ada unbounded queue, out of memory, process crash, merge backlog yang terus naik setelah recovery, atau sensitive diagnostic.
* Instrumentation journey serta throughput tetap dalam 5 persen latency `p95` serta CPU dan 10 persen RSS.
* Projected compressed retained bytes ditambah 30 persen merge headroom tidak memakai lebih dari 80 persen total disk. Sedikitnya 20 persen disk tetap bebas.
* Availability, disk, and Blind Spot alerts transition correctly under injected failures.

Capacity gagal jika satu gate gagal. Tuning boleh mengubah codec, index granularity, reader memory, threads, async buffer, atau derived projection di balik contract. Stable identity, sort key order, retention, public SLO, dan loss semantics memerlukan spec change jika hendak diubah.

## Promotion gates

Reader promotion memerlukan seluruh bukti berikut:

* Sedikitnya tujuh consecutive production days dalam dual mode.
* ClickHouse ACK ratio sedikitnya 99,9 persen untuk queue accepted batch secara keseluruhan dan per signal kind.
* Source serta target latest identity count sama untuk setiap completed backfill day.
* Deterministic sample checksum cocok 100 persen.
* Fixed query parity suite cocok untuk row identity, order, filter, cursor boundary, trace completeness, metric aggregate, options, dan expired behavior.
* Freshness serta query SLO hijau pada production traffic dan capacity report.
* Disk projection menyisakan required headroom.
* Tidak ada unresolved critical security, schema drift, availability, atau disk alert.

Gate report disimpan immutably pada `telemetry.signal_promotion_reports` di PostgreSQL Control dan linked ke CI artifact. Operator membuatnya melalui `bun run observability:promotion:record` dengan semua mode asal/target, evidence JSON, artifact URI, dan actor yang eksplisit. Perintah mengevaluasi semua gate sebelum menulis report.

`telemetry.signal_storage_activations` adalah ledger immutable untuk state aktif. Migration men-seed `postgres/postgres`. Operator wajib menjalankan `bun run observability:promotion:activate` untuk `postgres/postgres → dual/postgres`, lalu untuk setiap reader atau writer cutover dengan report ID yang persis cocok. Trigger PostgreSQL serta transaction/advisory lock mengharuskan state aktif sama dengan mode asal, memeriksa report yang sama, dan satu report hanya boleh dipakai sekali. Rollback `dual/clickhouse → dual/postgres` atau `clickhouse/clickhouse → dual/postgres` juga merupakan aktivasi operator eksplisit tanpa report. Backend runtime hanya memakai credential Control read-only dan menerima mode production non-baseline bila ledger aktif cocok dengan target konfigurasi; reader/writer cutover juga harus cocok dengan report ID serta hasil evaluasi ulang. Report yang hilang, state salah, report dipakai ulang, target berbeda, atau evaluasi gagal membuat Signal storage disabled dan Blind Spot, bukan bypass ke ClickHouse. Human operator tetap menyetujui config change; reader tidak berpindah otomatis.

Jobs tetap boleh memakai reader probe yang bounded untuk availability selama shadow write, tetapi reader tersebut tidak dapat dipakai untuk metric read mode yang dikonfigurasi. Metric read ClickHouse selalu memakai reader runtime yang melewati gate ledger yang sama.

## Cutover and rollback

### Phase 1: Extract

Pindahkan PostgreSQL Signal write ke adapter di balik `ObservabilitySignalStore`. Reader tetap PostgreSQL. Contract test membuktikan tidak ada behavior change.

### Phase 2: Shadow

Deploy ClickHouse schema dan adapter. Set writer `dual`, reader `postgres`. Jalankan tujuh hari shadow, backfill retained days, capacity test, dan promotion gates.

### Phase 3: Reader cutover

Set reader `clickhouse`, writer tetap `dual`. Pantau tujuh hari. PostgreSQL tetap lengkap sebagai rollback source.

### Phase 4: Writer cutover

Set writer serta reader `clickhouse`. Revoke runtime INSERT pada old PostgreSQL Signal tables dan jadikan read only. Catat cutover instant sebagai batas rollback completeness.

Setelah `bun run observability:promotion:activate` mencatat activation forward aktif `dual/clickhouse → clickhouse/clickhouse`, operator menjalankan policy writer lama sebelum deploy konfigurasi ClickHouse ke backend. Perintah ini tidak mengasumsikan PostgreSQL Control, telemetry source, dan logs source berada pada database yang sama. Ia memerlukan tiga URL operator eksplisit: `OBSERVABILITY_DATABASE_URL` untuk Control, `OBSERVABILITY_TELEMETRY_MIGRATION_URL` untuk source Span dan Metric Bucket, serta `OBSERVABILITY_LOGS_MIGRATION_URL` untuk source Application Log dan Access Log.

`project_migrator` adalah group role `NOLOGIN`, bukan credential koneksi. Ketiga URL harus authenticate sebagai satu migration login yang sama dan nama session nya dicantumkan pada `OBSERVABILITY_MIGRATION_LOGIN`. Perintah memeriksa `session_user` pada ketiga database, lalu memakai `SET LOCAL ROLE project_migrator` dalam setiap transaction. Ini membuat credential runtime tidak dapat menjalankan policy tanpa membership migrator, dan perubahan role tidak bocor ke connection pool. DBA menyediakan dedicated login operator dengan membership migrator yang tidak inherited, tetapi boleh di set secara eksplisit. `project_migrator` sendiri wajib memiliki membership inherited pada `project_logs_writer`, sehingga ia dapat mengubah ownership dua Signal log tree dan tetap menulis Audit Trail tanpa mengubah `logs.audit_trails`.

```sql
CREATE ROLE observability_cutover_operator LOGIN NOINHERIT;
GRANT project_migrator TO observability_cutover_operator WITH INHERIT FALSE;
GRANT project_migrator TO observability_cutover_operator WITH SET TRUE;
GRANT project_logs_writer TO project_migrator WITH INHERIT TRUE;
GRANT project_logs_writer TO project_migrator WITH SET TRUE;
```

Password, TLS, expiry, dan secret login tetap dikelola DBA atau secret manager. Local rehearsal boleh memakai migration login yang ada jika ia dapat `SET ROLE project_migrator`, tetapi production tidak memakai superuser credential.

Sebelum lock, DBA juga memastikan `project_migrator` memiliki `CREATE` pada setiap schema yang memiliki relation Signal log, dan `project_logs_writer` memiliki `CREATE` pada schema yang sama untuk unlock. Umumnya schema tersebut adalah `logs` dan `partition`, tetapi command memeriksa catalog relation aktual agar tidak mengasumsikan layout partisi. `CREATE` pada `partition` tidak dicabut secara global karena Audit Trail masih memerlukannya untuk partisi baru. Ownership parent Signal yang dipindahkan tetap mencegah runtime attach partition baru ke Signal tree.

```text
bun run observability:postgres:legacy-write-policy -- \
  --action lock \
  --activation-id <activation-uuid> \
  --actor-id <operator-id> \
  --reason <approved-change-reason> \
  --confirm lock:<activation-uuid>
```

Set environment `OBSERVABILITY_MIGRATION_LOGIN=observability_cutover_operator` untuk setiap invocation. Operator menjalankan bentuk yang sama dengan `--dry-run` pada rehearsal. Perintah mengambil advisory lock Control yang sama dengan activation sebelum membaca state, sehingga activation lain tidak dapat melewati preflight sampai policy selesai. Ia hanya menerima activation yang masih aktif dan persis merupakan forward writer cutover. Telemetry source hanya memerlukan `project_migrator` dan `project_telemetry_writer`; logs source hanya memerlukan `project_migrator` dan `project_logs_writer`, sehingga deployment database terpisah tidak diasumsikan memiliki role runtime yang tidak dipakai. Ia memeriksa owner dan schema `CREATE` privilege setiap parent dan descendant, memegang bounded lock, lalu mencabut `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, dan `TRIGGER` dari setiap role aplikasi pada empat tree Signal. Hanya parent serta descendant `logs.logging` dan `logs.access_logs` yang ownership nya dipindahkan ke `project_migrator`; `logs.audit_trails` tidak disentuh dan akses `SELECT` tetap ada. Perintah memeriksa ulang bahwa seluruh relation Signal dimiliki `project_migrator`, tidak ada role aplikasi non superuser yang masih memiliki privilege write, dan tidak ada login selain migration login yang dapat `SET ROLE project_migrator` sebelum commit. Action sukses menulis strict Audit Trail dengan actor, reason, activation, hasil, dan waktu.

Output `readOnlyUntil` selalu dihitung sebagai 30 hari UTC dari `activatedAt`. Melewati waktu itu tidak membuka kembali writer dan tidak menghapus tabel otomatis. Retirement tetap migration terpisah setelah retention serta rollback window diverifikasi.

Jika rollback writer diperlukan, operator lebih dahulu menjalankan activation rollback `clickhouse/clickhouse → dual/postgres`. Control wajib mencatat Blind Spot mulai cutover instant. Hanya setelah activation rollback tersebut aktif, command dapat dijalankan dengan `--action unlock` dan confirmation `unlock:<activation-uuid>` untuk memulihkan grant telemetry serta ownership dua Signal log tree. Unlock juga menghasilkan Audit Trail. Operator tidak deploy konfigurasi `dual/postgres` sampai unlock berhasil, sehingga kegagalan partial tetap fail closed dan tidak mengizinkan writer lama tanpa rollback yang tercatat.

### Phase 5: Retirement

Pertahankan old PostgreSQL Signal tables 30 hari. Migration terpisah memeriksa retention serta rollback window selesai, memverifikasi Control tidak bergantung pada table itu, lalu drop old Span, Metric Bucket, Application Log, dan Access Log storage. Audit Trail tidak disentuh.

Sebelum Phase 4, rollback mengubah reader ke `postgres` serta writer ke `dual` tanpa code deployment. Sesudah Phase 4, PostgreSQL reader hanya lengkap sampai cutover instant. Setiap interval sesudahnya yang tidak ada di PostgreSQL dinyatakan sebagai Blind Spot jika rollback dilakukan.

## Single node failure and maintenance

Planned maintenance maksimal 30 menit. Application tetap menerima business traffic. Queue tetap bounded dan boleh drop setelah cap atau retry. Seluruh kehilangan dicatat sebagai Blind Spot. Maintenance lebih lama menjadi incident dan memicu availability alert.

Node loss recovery:

1. Availability alert tetap firing di PostgreSQL.
2. Provision dedicated VM dengan pinned binary, TLS, disk encryption, dan network policy.
3. Jalankan ClickHouse migration runner sampai schema gate lulus.
4. Buka writer serta reader pada database kosong.
5. Record missing interval sebagai Blind Spot. Tidak ada restore atau cold archive.
6. Jika old PostgreSQL shadow masih berada dalam migration window, operator boleh menjalankan bounded backfill untuk covered interval.

Disk guard memberi warning 70 persen, memblokir backfill 80 persen, dan menjalankan incident policy 90 persen. TTL merge dapat dipicu atau ditune, tetapi operator tidak melakukan unbounded mutation saat incident.

## Secrets and audit

Migrator credential hanya ada pada migration host dan tidak masuk runtime environment. Writer, reader, serta TLS secrets dapat dirotasi dengan membuat credential baru, deploy caller, membuktikan successful access, lalu revoke credential lama. Secret tidak masuk version control atau diagnostic.

ClickHouse system query log aktif tujuh hari untuk database operators. Migration execution, config mode change, promotion approval, rollback, credential rotation, maintenance, node rebuild, dan old table drop menghasilkan strict PostgreSQL Audit Trail dengan actor, reason, time, dan safe result.

## Rationale

Native single node dipilih karena engineer menerima availability serta retention loss tradeoff dan ingin operasi awal tetap kecil. Capacity gate membuat hardware floor menjadi hypothesis yang bisa ditolak, bukan angka pemasaran. No backup hanya konsisten karena Signal dipisahkan dari Audit Trail dan Control.

Forward only migration, dual write, dan delayed retirement dipilih karena ClickHouse DDL serta cross database writes tidak transactional. Membuat perubahan additive lalu memindahkan traffic melalui explicit configuration memberi rollback yang jauh lebih nyata daripada down migration atau big bang switch.
