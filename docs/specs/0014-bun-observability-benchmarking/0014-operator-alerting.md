# 0014. Operator surfaces and alerting standard

## Summary

Operator memakai API dan viewer internal untuk trace, metric, benchmark, baseline, dan alert. Seluruh read memerlukan permission observability khusus. CI ingestion dan CPU profile memiliki jalur terpisah yang tidak membuka write endpoint publik.

## Ownership

Logs service memiliki module observability dan query schema `telemetry` melalui role `project_telemetry_reader`. Gateway mengekspos route public di bawah `/api/v1/observability`. Angular menambah area operator di bawah halaman log. Runtime writer tidak melewati API ini.

## API surface

| Endpoint | Method | Inputs | Outputs | Key errors |
| --- | --- | --- | --- | --- |
| `/api/v1/observability/traces` | GET | time range max 24 hours, service, resource kind, resource name, status, correlation ID, request ID, run ID, cursor | trace summaries, next cursor, completeness | 401, 403, 422, 503 |
| `/api/v1/observability/traces/:traceId` | GET | runtime trace ID | span tree, orphan roots, correlation links, sampling reason, completeness | 401, 403, 404, 503 |
| `/api/v1/observability/metrics` | GET | time range max 30 days, metric, service, resource, statistic, step, allowed group | typed series, unit, coverage, drop count | 401, 403, 422, 503 |
| `/api/v1/observability/benchmarks/runs` | GET | scenario, status, commit, Bun version, cursor | run summaries, comparison status, next cursor | 401, 403, 422, 503 |
| `/api/v1/observability/benchmarks/runs/:runId` | GET | run ID | run, comparison rows, compatibility key, artifact URI, trace URI | 401, 403, 404, 503 |
| `/api/v1/observability/benchmarks/baselines` | GET | scenario and compatibility filters | active and historical baseline summaries | 401, 403, 422, 503 |
| `/api/v1/observability/alerts` | GET | status, severity, service, cursor | alert states and evidence links | 401, 403, 422, 503 |
| `/api/v1/observability/alerts/:ruleId` | GET | rule ID and optional series fingerprint | rule manifest projection and current states | 401, 403, 404, 503 |
| `/internal/observability/benchmark-ingestions` | POST | signed canonical JSON max 5 MiB | ingestion ID, checksum, projection counts | 401, 409, 413, 422, 503 |

List endpoint memakai cursor, bukan offset. Query memakai field allowlist dan statement timeout. Trace yang tidak ada dan trace yang sudah lewat retention sama sama mengembalikan 404.

## Viewer

Viewer mempunyai empat area yang memakai generated gateway SDK.

* Trace search menampilkan service, root operation, status, duration, start, correlation link, sampling reason, dan incomplete marker. Detail membentuk waterfall dari parent relation dan menampilkan orphan span sebagai root terpisah.
* Metric explorer hanya menawarkan metric, filter, statistic, step, dan group yang didukung API. Missing bucket ditampilkan sebagai gap dan bukan nol.
* Benchmark view menampilkan run, active baseline, delta, threshold, decision, Bun version, commit, runner profile, artifact link, dan trace link.
* Alert view menampilkan `pending`, `firing`, `resolved`, atau `unknown`, jumlah breach window, evidence time, dan last notification.

Setiap area mempunyai loading, empty, unauthorized, forbidden, query error, dan healthy state. Trace detail mempunyai expired serta incomplete state. Metric mempunyai gap state. Benchmark mempunyai stale projection dan not comparable state.

## Authorization

Gateway memeriksa `observability:telemetry:read`, meneruskan signed identity, lalu logs service memeriksa permission yang sama. Permission `logs:log:read` tidak memberi akses observability. Endpoint read tidak menerima user ID dari query atau body.

Access service mengirim perubahan permission ke notification recipient projection. Notification menambah `canReadObservability`. Alert fanout hanya memilih recipient aktif dengan nilai true. Isi notification hanya membawa severity, rule key, service, time, dan action route. Metric value, trace ID, resource value, dan raw evidence tidak masuk notification. Viewer melakukan auth lagi saat link dibuka.

## CI machine identity

Ingestion memakai header berikut.

```text
x-observability-key-id
x-observability-timestamp
x-observability-nonce
x-observability-signature
```

Canonical signature input adalah:

```text
METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256_BODY
```

Signature memakai HMAC SHA256. Timestamp memiliki skew maksimal 60 detik. Identity hanya mempunyai `observability:benchmark:write`. Key ring menerima active dan previous key agar rotation tidak memerlukan downtime.

Table support `telemetry.ingestion_receipts` menyimpan key ID, nonce, body checksum, response status, response checksum, dan expiry. `(key_id, nonce)` unique berlaku di semua instance. Receipt bertahan lima menit. Retry dengan key, nonce, dan body checksum yang sama mengembalikan response tersimpan tanpa mengeksekusi transaction lagi. Nonce yang sama dengan body checksum berbeda ditolak sebagai replay. Nonce baru dengan ingestion ID dan body checksum yang sudah tersimpan mengembalikan hasil idempotent yang sama.

## Alert rules and state

Rule berasal dari manifest Git berversi. Projection read only memberi viewer title, severity, metric, filter, threshold, dan checksum. Evaluator berjalan sebagai durable schedule pada jobs service.

Initial rule set mencakup:

* latency `p95` di atas threshold per resource
* error rate di atas 5 persen dengan minimal 20 operation dalam lima menit
* telemetry drop lebih dari nol
* memory pressure critical lebih dari nol
* tiga expected bucket yang hilang
* evaluator execution failure

Tiga jendela lima menit berturut turut mengubah state dari `pending` ke `firing`. Tiga jendela sehat mengubahnya ke `resolved`. Missing data menjadi `unknown` dan tidak dianggap recovery.

`telemetry.alert_states` memakai primary key `(rule_id, rule_version, series_fingerprint)`. Field wajib adalah status dengan nilai `pending`, `firing`, `resolved`, atau `unknown`, consecutive breach windows, transition sequence, first breached time, last evaluated time, dan evidence bucket. Last notified serta resolved time nullable. Transition sequence bertambah hanya ketika status benar benar berubah.

Transisi `firing` dan `resolved` membuat durable notification job dalam transaction evaluator yang sama dengan perubahan state. Idempotency key dibentuk dari rule ID, rule version, series fingerprint, dan transition sequence. Retry memakai policy jobs yang ada dan tidak membuat notification kedua. Full telemetry PostgreSQL outage tidak dapat menghasilkan alert saat outage berlangsung. Setelah pulih, evaluator membuat gap evidence dan notification.

## Metric query rules

Percentile dihitung dari canonical histogram bucket, bukan dari percentile per process. Allowed group adalah service, resource kind, resource name, status, dan label registry yang dinyatakan rule. Query menolak group lain, rentang terlalu lebar, step di bawah 60 detik, metric unknown, serta estimated series di atas batas server.

## Benchmark projection

`benchmark_runs`, `benchmark_baselines`, dan `benchmark_comparisons` memakai field dari child benchmark ditambah source commit, source checksum, artifact URI, dan ingestion time. Comparison dipartisi bulanan. Baseline tidak dipartisi. Ingestion atomic dan projection tidak pernah menjadi sumber Git snapshot baru.

## CPU profile CLI

```text
bun run observability:profile --service <name> --pid <pid> --duration <seconds>
```

Duration maksimal 60 detik dan hanya satu profile boleh aktif per service. CLI hanya menjalankan mekanisme CPU profile yang lulus compatibility test pada Bun 1.4. Runtime tanpa capability keluar dengan `unsupported_runtime` dan tidak menyentuh service state. Partial artifact dihapus.

Artifact memakai permission pemilik proses, tidak tersedia melalui HTTP, dan dihapus setelah 24 jam. Start, stop, failure, service, duration, dan artifact checksum dicatat sebagai application event aman. Heap snapshot berada di luar cakupan karena dapat membawa data sensitif.

## Value sourcing

| Value | Source |
| --- | --- |
| runtime trace tree | `telemetry.spans` grouped by trace ID and parent span ID |
| correlation link | span correlation ID plus spec 0011 log fields |
| metric percentile | canonical histogram boundaries and counts |
| metric coverage | expected bucket count minus stored bucket count |
| dropped telemetry | typed drop counters persisted after writer recovery |
| benchmark compatibility | Scenario, Run, and Baseline compatibility fields |
| comparison decision | candidate value, baseline snapshot, and threshold policy version |
| stale projection | source checksum from Git or artifact compared with projection checksum |
| alert recipient | active notification projection with `canReadObservability` |
| service instance | `SERVICE_INSTANCE_ID` from deployment |
| rule and slow threshold | versioned Git manifest and checksum |
| artifact link | signed ingestion body value validated against allowed URI policy |

## Configuration

```text
OBSERVABILITY_SERVICE_URL
OBSERVABILITY_QUERY_TIMEOUT_MS default 5000
OBSERVABILITY_MAX_SERIES default 200
OBSERVABILITY_INGESTION_KEYS active and previous key ring
OBSERVABILITY_INGESTION_MAX_BYTES default 5242880
OBSERVABILITY_ALERT_RULES_PATH
OBSERVABILITY_PROFILE_DIR
OBSERVABILITY_PROFILE_MAX_SECONDS default 60
```

## Consequences

Operator dapat mengikuti bukti dari alert ke metric, trace, log, dan benchmark tanpa direct database access. Biayanya adalah API time series, viewer waterfall, replay storage, permission projection, dan evaluator yang harus dirawat di dalam produk. Full PostgreSQL outage tetap tidak terlihat sampai storage atau service pulih.
