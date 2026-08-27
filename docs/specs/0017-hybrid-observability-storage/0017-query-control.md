# 0017. Query and control

## Summary

Logs service membaca Signal dari ClickHouse dan Control dari PostgreSQL tanpa cross database join. Signal list memakai bounded time range serta keyset cursor, sedangkan Audit Trail tetap memakai exact PostgreSQL paging. Health serta alert state disimpan di PostgreSQL agar ClickHouse tetap dapat dilaporkan ketika node gagal.

## Ownership

`apps/services/logs` tetap memiliki public query behavior, Elysia schema, permission check, dan mapping response. Implementation di dalam module dipisah menjadi Signal query untuk ClickHouse dan Control repository untuk PostgreSQL. Ini bukan interface shared baru. Shared producer tetap hanya melihat `ObservabilitySignalStore`.

Jobs service membaca bounded Metric Bucket serta ClickHouse health dengan reader credential. Ia menulis alert rule, alert state, transition, dan notification job ke PostgreSQL. Tidak ada transaction lintas PostgreSQL serta ClickHouse.

## PostgreSQL Control model

Tabel berikut tetap di PostgreSQL:

| Entity | Purpose | Exactness contract |
|---|---|---|
| `logs.audit_trails` | Accountability atas business mutation | Strict write, transaction sesuai caller, exact query |
| `telemetry.benchmark_runs` | Lifecycle serta identity benchmark | Transactional projection dari signed artifact |
| `telemetry.benchmark_baselines` | Approved baseline projection | Foreign key dan satu active compatibility key |
| `telemetry.benchmark_comparisons` | Per metric benchmark decision | Foreign key ke run serta baseline |
| `telemetry.alert_rules` | Versioned rule projection | Exact manifest checksum dan active state |
| `telemetry.alert_states` | Alert state machine | Unique rule version serta series fingerprint |
| `telemetry.ingestion_receipts` | Replay serta idempotency receipt | Unique key ID dan nonce, retention lima menit |
| `telemetry.signal_schema_migrations` | ClickHouse DDL history | Ordered version dan immutable checksum |
| `telemetry.signal_migration_runs` | Backfill checkpoint serta parity evidence | Resumable range state dan immutable completed evidence |

### `telemetry.signal_schema_migrations`

```text
target_id             UUID serverUUID() ClickHouse, bersama version adalah primary key
version               bigint
name                  varchar(150) required
checksum              char(64) required, unique bersama target_id
clickhouse_version    varchar(50) required
execution_ms          bigint required
applied_at            timestamp required UTC
```

`target_id` berasal langsung dari `serverUUID()` ClickHouse yang persisted pada data directory. Hostname serta endpoint tidak dipakai sebagai identity karena dapat dipakai kembali saat node dibangun ulang. Migration dengan version sama dan checksum berbeda pada target yang sama adalah drift dan selalu gagal. Exact ClickHouse version direkam agar operator dapat membedakan schema dari binary change.

History global sebelum target scoped dipertahankan sebagai `telemetry.signal_schema_migration_history_legacy`, immutable dan read only. Runner tidak pernah menganggap row legacy sebagai bukti migration pada target baru. Pada upgrade pertama, runner menjalankan kembali DDL idempotent serta postcondition untuk membangun history target scoped yang baru. Dengan demikian node yang dibangun ulang mendapat semua migration walaupun PostgreSQL masih menyimpan audit node lama.

### `telemetry.signal_migration_runs`

```text
run_id                uuid primary key
signal_kind           varchar(30) required
schema_version        integer required
source_from           timestamp required UTC
source_to             timestamp required UTC
source_cursor         jsonb nullable
source_count          bigint required default 0
target_count          bigint required default 0
sample_modulus        integer required default 1000
source_checksum       char(64) nullable
target_checksum       char(64) nullable
status                pending | running | paused | succeeded | failed
error_code            varchar(100) nullable
started_at            timestamp nullable UTC
updated_at            timestamp required UTC
finished_at           timestamp nullable UTC
```

Range selalu satu UTC day dan `source_from < source_to`. Hanya satu nonterminal run boleh ada untuk signal kind, schema version, dan source range yang sama. Resume memakai `source_cursor` yang sudah committed. Status `succeeded` immutable. Error text bebas tidak disimpan, hanya stable safe code.

`source_cursor` adalah versioned object yang membawa event time serta stable ID terakhir sesuai entity. Ia juga membawa source query fingerprint agar resume dengan range, schema, atau ordering berbeda ditolak.

## Cross store consistency

* Audit Trail ditulis di PostgreSQL bersama business mutation ketika contract memerlukannya. Audit tidak pernah menunggu atau bergantung pada ClickHouse.
* Signal append bukan bagian business transaction dan tidak menjadi syarat commit.
* Benchmark projection ditulis atomically di PostgreSQL. `run_id` pada Span hanya logical link dan boleh tidak ada karena sampling, retention, atau Blind Spot.
* Alert evaluation membaca satu immutable time window dari ClickHouse, lalu menulis state serta notification job dalam satu PostgreSQL transaction. Retry memakai evaluation time, rule version, series fingerprint, dan transition sequence agar tidak membuat notification kedua.
* Cross store query dilakukan application side melalui IDs. SQL federation dan distributed transaction dilarang.

## Signal read model

Canonical ClickHouse tables adalah sumber Signal. Initial implementation mengutamakan bounded canonical query. Derived table atau projection hanya ditambah ketika capacity test menunjukkan kebutuhan.

Derived read model yang diizinkan:

* Trace summary per trace untuk root operation, start, finish, status, span count, sampling reason, correlation, request, run, dan completeness.
* Bounded filter option per signal serta time bucket.
* SLO rollup yang dapat dihitung ulang dari Metric Bucket.

Setiap derived row membawa schema version, source window, dan source watermark. Ia dapat dihapus serta dibangun ulang dari canonical Signal. Additive materialized view yang dapat double count karena retry dilarang sampai deduplication behavior dibuktikan oleh integration test. Projection yang tertinggal lebih dari freshness SLO tidak boleh menghasilkan zero atau healthy. Reader memakai canonical fallback dalam guard atau menyatakan Blind Spot.

## Time range and filter rules

Default list range adalah 24 jam. Preset adalah 15 menit, 1 jam, 6 jam, dan 24 jam. Custom range maksimum mengikuti retention entity:

* Span paling lama 7 hari.
* Metric Bucket, Application Log, dan Access Log paling lama 30 hari.

Range wajib memiliki `from < to`, memakai UTC instant, dan tidak melewati now plus lima menit. Query yang lebih tua dari retention ditolak 422 daripada diam diam memotong rentang.

Trace mempertahankan service, resource kind, resource name, status, correlation ID, request ID, serta run ID filter. Metric mempertahankan metric, service, resource, statistic, step, dan allowed group. Application Log mempertahankan search, level, module, event, serta actor scope yang sudah ada. Access Log mempertahankan search, event, outcome, trace ID, serta actor scope yang sudah ada.

Search selalu membutuhkan time range. Field serta group memakai allowlist. Free regular expression, raw SQL, arbitrary JSON path, arbitrary group, dan user selected sort field tidak tersedia.

## Cursor contract

Signal list memakai opaque base64url cursor dengan maximum 512 karakter. Decoded payload tervalidasi memiliki:

```text
version
signalKind
direction next | prev
eventTime
stableId
filterFingerprint
```

`filterFingerprint` adalah SHA256 dari canonical time range, normalized filters, page size, dan sort contract. Cursor dari filter, entity, atau version lain menghasilkan 422. Event time serta stable ID harus valid bagi entity. Row boundary yang sudah lewat retention menghasilkan 422 expired cursor.

Next query mengikuti sort order canonical. Previous query membalik comparison serta database order, mengambil satu page, lalu mengembalikan row dalam canonical display order. Membuka page ketiga lalu Previous dua kali harus menghasilkan page pertama yang identik.

Application Log serta Access Log memakai page size 25. Trace memakai page size 50. Response membawa jumlah row page melalui panjang `data`, bukan exact total. `prevCursor` null pada page pertama dan `nextCursor` null ketika tidak ada row lanjutan.

Audit Trail tidak memakai Signal cursor dan mempertahankan page size 25, exact total, total pages, serta offset query PostgreSQL.

## Query budgets

Satu logs service instance memiliki semaphore delapan concurrent Signal query. Ketika seluruh slot dipakai, request baru langsung menghasilkan 429 dan `Retry-After: 1`. Request tidak menunggu antrean yang tidak bounded.

Hard application deadline:

* Lima detik untuk range sampai 24 jam.
* Sepuluh detik untuk range lebih dari 24 jam sampai retention maksimum.

ClickHouse reader profile memakai readonly mode, query time limit yang sama, result row serta byte cap, memory cap, thread cap, dan overflow mode `throw`. Exact memory serta thread values ditetapkan oleh capacity test untuk hardware yang dipin. Jumlah query pada reader user tidak boleh lebih kecil dari total semaphore logs dan jobs pada deployment profile.

Public SLO tetap lebih ketat dari hard deadline, yaitu latency `p95` dua detik untuk 24 jam serta lima detik untuk range lebih panjang. Timeout atau quota failure tidak boleh disamarkan sebagai empty healthy result.

## API behavior

Application Log serta Access Log response berubah dari `meta` page menjadi:

```text
data
prevCursor
nextCursor
filters
options
storageStatus available | blind_spot
```

Options dihitung dalam time range dan actor scope yang sama dengan list. Aplikasi web menulis time, filter, serta cursor ke query string, mempertahankan filter ketika cursor expired, dan menampilkan jumlah row page tanpa page number, First, Last, atau exact total.

Trace serta Metric response mempertahankan contract spec 0016. Trace summary yang berasal dari sampled data memberi completeness `partial` ketika parent, drop evidence, atau projection watermark menunjukkan gap. Metric coverage membandingkan expected bucket dengan stored bucket dan menampilkan missing bucket sebagai gap.

Error behavior:

| Condition | List | Detail |
|---|---|---|
| Signal storage unreachable atau unreadable | 200, empty data, `storageStatus: blind_spot` | 503 |
| Query concurrency penuh | 429 dengan `Retry-After` | 429 dengan `Retry-After` |
| Invalid range, filter, group, atau cursor | 422 | 422 |
| Signal sudah lewat retention atau stable ID tidak ada | Not applicable | 404 |
| PostgreSQL Control unavailable | 503 | 503 |

Blind Spot list menyertakan empty cursors serta empty options dan tidak pernah menyatakan completeness penuh. Respons list membawa `blindSpotSince` nullable sebagai proyeksi aman dari diagnostic process-local yang sama; UI menampilkan interval tersebut, bukan empty state biasa. Endpoint health tetap internal dan tidak diproxy gateway.

## Storage health

Setiap Bun backend yang memakai Signal store mendaftarkan `GET /internal/observability/storage-health` pada internal listener. Endpoint membaca local `ObservabilitySignalStore.diagnostics()` serta startup schema check. Ia tidak melakukan unbounded ClickHouse query. Respons minimum:

```text
state available | blind_spot | disabled
blindSpotSince nullable
droppedByReason
queueDepth
queueBytes
lastAcknowledgedAt nullable
schemaVersion
failureCode nullable
checkedAt
```

Endpoint hanya berada pada internal listener serta private network. Gateway tidak memiliki proxy route. Signed identity harus valid dan memiliki setidaknya satu permission dari trace, metric, benchmark, baseline, atau alert observability catalog. Raw exception, endpoint credential, query, dan row tidak masuk response.

Endpoint adalah diagnostic process local. Ia tidak mengklaim mengagregasi semua backend instance. Deployment inventory menentukan setiap instance yang discrape atau diperiksa operator.

## Availability and disk alerts

Jobs service menjalankan probe setiap 30 detik memakai ClickHouse reader credential. Probe memeriksa connectivity, server version, required database serta schema version, dan `system.disks` usage dengan bounded query.

System managed rule `observability.signal_store.available` memakai satu global series fingerprint. Kegagalan pertama menghasilkan pending. Kegagalan kedua berurutan menghasilkan firing dan durable notification. Tiga keberhasilan berurutan menghasilkan resolved. Transition sequence serta notification idempotency mengikuti existing alert contract.

Metric rule yang tidak dapat membaca ClickHouse menjadi unknown dan tidak menambah healthy window. Missing Signal tidak pernah menyelesaikan firing alert. Setelah recovery, evaluator melanjutkan window baru serta menyertakan gap evidence.

Disk rules:

* Warning pada usage 70 persen.
* Firing pada usage 80 persen.
* Critical pada usage 90 persen.

Disk 80 persen atau lebih juga memblokir backfill. Disk 90 persen menghentikan nonpriority Signal intake jika diperlukan untuk menjaga node, mempertahankan diagnostic, dan membuka Blind Spot.

## Authorization and data safety

Public route mempertahankan per signal permission spec 0016. Permission log tidak memberi akses trace atau metric dan sebaliknya. Gateway memeriksa permission, meneruskan signed identity, lalu logs service memeriksa kembali.

Reader hanya menerima parameter dari Elysia schema. Column, table, group, statistic, direction, serta sort expression berasal dari internal allowlist. Value dikirim sebagai ClickHouse HTTP query parameters atau format binding, bukan string concatenation.

Application serta Access Log tetap dapat membawa actor, email, IP, session, dan user agent yang sudah disetujui. UI hanya menampilkan field sesuai existing contract. Sensitive fields yang dilarang tidak boleh muncul pada option, cursor, alert evidence, diagnostic, atau query log.

## Rationale

Signal dan Control dibaca bersama pada operator journey, tetapi tidak memiliki durability contract yang sama. Menjaga Control di PostgreSQL membuat ClickHouse outage masih dapat menghasilkan state firing, unknown, migration checkpoint, dan notification. Application side correlation dipilih di atas cross database join karena relation bersifat optional serta time bounded.

Cursor menang atas offset untuk growing Signal karena biayanya stabil dan tidak membutuhkan exact count. PostgreSQL Audit Trail tetap offset based karena ia adalah Control dengan behavior UI yang sudah ada dan volume serta exactness contract berbeda.
