# 0014. Benchmark and baseline standard

## Summary

Benchmark mengukur aplikasi ini pada scenario dan runner yang dapat diulang. Setiap run membawa identity build, Bun, fixture, environment, instrumentation, dan mesin. Baseline tidak pernah berubah otomatis setelah regresi.

## Sources of truth

```text
benchmarks/scenarios/*.json       Scenario manifests
benchmarks/baselines/**/*.json    Approved immutable baseline snapshots
benchmarks/impact-map.json        Source path to affected scenario mapping
CI artifact JSON                  Run and Comparison source
CI artifact Markdown              Human report
PostgreSQL telemetry projection   Operator read model only
```

Git adalah sumber Scenario dan Baseline. Artifact CI adalah sumber Run dan Comparison. Projection PostgreSQL wajib menyimpan source commit, checksum, artifact URI, dan ingestion time agar stale data terlihat.

## Scenario model

Satu manifest memiliki field wajib berikut.

```text
scenario_id
scenario_version
kind journey | microbenchmark | throughput
overhead_policy required | diagnostic
runner
fixture_version
warmup_iterations
measured_iterations
timeout_ms
tags
required_resource_kinds
manifest_checksum
```

Initial journey mencakup login dan session, user dan permission, pencarian log, serta job sampai notification. Microbenchmark pertama mencakup context propagation, span lifecycle, histogram aggregation, queue batching, query wrapper, NATS carrier, dan sanitizer boundary. Throughput scenario memakai loop `fetch` dari driver Bun yang terpisah dari service.

## Run model

`Run` memakai UUIDv7 dan field berikut.

```text
run_id
scenario_id
scenario_version
commit_sha
branch nullable
bun_version
instrumentation_schema_version
environment
runner_profile
fixture_version
started_at
finished_at nullable
status queued | running | completed | failed | incomplete
telemetry_complete
dropped_telemetry_count
latency_overhead_percent
cpu_overhead_percent
rss_overhead_percent
artifact_uri nullable
trace_uri nullable
failure_reason nullable
```

`comparison_status` terpisah dari lifecycle run dan bernilai `pass`, `fail`, `calibrating`, atau `not_comparable`.

## Runner profile

Runner profile menggabungkan manifest resmi dengan OS, architecture, CPU model, core count, memory, Bun version, network class, effective success sample rate, dan mode instrumentation (`production-sampling` atau `trace-capture`) hasil observasi. Canonical JSON dihash menjadi ID stabil. Klaim manifest yang berbeda dari observasi membuat run incomplete.

Candidate commit dideploy ke staging terisolasi. GitHub Actions driver berjalan pada executor terpisah dan menghapus environment setelah run. Skenario terdampak menjadi required check pada pull request. Full suite berjalan nightly dan pada release.

## Measurement protocol

* Runner memakai `Bun.nanoseconds()` untuk duration dan tidak menambah framework microbenchmark.
* Setiap scenario melakukan warmup lalu lima group pengukuran.
* Scenario percentile menghasilkan paling sedikit 100 observation per metric. Kurang dari itu membuat run incomplete.
* Nilai candidate adalah median dari lima group. Coefficient of variation di atas 10 persen membuat run noisy dan incomplete.
* Driver merekam CPU dan event loop lag miliknya sendiri.
* Run incomplete ketika CPU driver lebih dari 80 persen, event loop lag `p95` lebih dari 10 ms, atau throughput naik saat concurrency diturunkan.
* CPU, RSS, JavaScriptCore heap, event loop lag, throughput, error, operation count, dan latency `p50`, `p95`, serta `p99` selalu masuk artifact.
* Benchmark overhead membandingkan pasangan instrumentation off dan on pada candidate yang sama. Pasangan ini wajib untuk perubahan telemetry, nightly, dan release.
* Scenario `microbenchmark` memakai `diagnostic` untuk overhead. Ia tetap menyimpan nilai overhead mentah, tetapi tidak menggagalkan run karena operasi kosong mengukur rasio biaya instrumentation terhadap kerja aplikasi yang hampir nol. Scenario `journey` dan `throughput` memakai `required`, sehingga latency `p95`, CPU, dan RSS menjadi gate acceptance.

## Baseline model

Baseline adalah snapshot immutable yang menunjuk satu approved run.

```text
baseline_id
scenario_id
scenario_version
approved_run_id
fixture_version
environment
runner_profile
instrumentation_schema_version
threshold_policy_version
approval_commit_sha
promoted_at
metric_snapshot
supersedes_baseline_id nullable
```

Compatibility key adalah scenario version, scenario kind, overhead policy, fixture version, environment, runner profile, dan instrumentation schema version. Bun version dan commit boleh berbeda dan selalu ditampilkan. Hanya satu baseline aktif per compatibility key.

Kalibrasi membutuhkan sedikitnya 20 run valid pada runner resmi. Setiap metric kalibrasi tetap harus memiliki coefficient of variation paling tinggi 10%. Run ekstrem dikeluarkan dengan pagar outlier Tukey, yaitu 1,5 kali interquartile range di bawah kuartil pertama dan di atas kuartil ketiga; sedikitnya 20 run inlier harus tersisa. Approved run adalah medoid nyata yang paling dekat dengan median vector run inlier. Promosi membuat pull request dengan snapshot baru. Baseline lama tetap ada dalam Git history.

Run tanpa baseline atau dengan compatibility key berbeda mendapat `not_comparable`. Ia membuat report tetapi tidak menggagalkan CI karena regresi.

## Comparison model

Satu `Comparison` mewakili satu metric dan resource.

```text
comparison_id
run_id
baseline_id
resource_kind
resource_name
metric_key
statistic
unit
baseline_value
candidate_value
absolute_delta
relative_delta_percent
absolute_threshold
relative_threshold
decision pass | fail
evidence_uri nullable
created_at
```

`Comparison` memakai partisi bulanan pada projection PostgreSQL. Artifact run dan comparison bertahan 90 hari. Snapshot baseline bertahan dalam Git.

## Regression policy

* Latency gate memakai `p95`. Ia gagal ketika memburuk lebih dari 10 persen dan lebih dari 5 ms.
* CPU dan RSS gagal ketika memburuk lebih dari 10 persen. Pada scenario dengan overhead policy `required`, overhead instrumentation memiliki batas lebih ketat, yaitu 5 persen untuk CPU dan latency `p95`, serta 10 persen untuk RSS. Policy `diagnostic` tetap menampilkan angka tanpa menjadikannya gate.
* Throughput gagal ketika turun lebih dari 10 persen.
* Error baru gagal ketika baseline bernilai nol. Baseline dengan error memakai batas relatif 10 persen dan minimal satu error tambahan.
* Operation count per journey memakai maximum pada Scenario. Penambahan query, message, SMTP, atau HTTP keluar di atas maximum gagal agar N plus one terlihat.
* `p50`, `p99`, heap, dan event loop selalu dibandingkan serta dilaporkan. Metric ini menjadi gate hanya ketika threshold policy manifest menamainya.

## Artifact contract

Artifact JSON memakai schema version, canonical key order, UTC timestamp, numeric unit eksplisit, dan SHA256 checksum. Markdown dibuat hanya dari JSON yang sama. Secret, cookie, token, email, user ID, request body, SQL, dan payload tidak boleh masuk artifact.

`trace_uri` menunjuk viewer internal dengan `run_id` atau runtime trace ID. Jika trace partial, report menyatakan incomplete dan tidak menyembunyikannya sebagai data nol.

## Projection ingestion

CI mengirim satu canonical document ke internal ingestion endpoint. Seluruh Run, Baseline, Comparison, dan source metadata divalidasi lalu ditulis dalam satu transaction. Retry dengan ID dan checksum sama mengembalikan hasil idempotent. ID sama dengan checksum berbeda menghasilkan conflict dan tidak menulis data.

## Value sourcing

```text
scenario identity       Scenario manifest
fixture version         Scenario manifest and fixture checksum
commit and branch       GitHub Actions checkout metadata
Bun version             running Bun process
runner fingerprint      observed runner facts + runner manifest
instrumentation version packages/telemetry schema constant
metric values           runtime probes and canonical histogram
thresholds              versioned threshold policy manifest
baseline values         approved Git snapshot
artifact URI            CI upload result
trace URI               operator base URL + stored runtime trace ID or run ID
```

## Consequences

Perbandingan menjadi reviewable dan tidak dapat diam diam menyerap regresi. Biayanya adalah staging terisolasi, runtime yang lebih panjang, custom statistics, serta pemeliharaan impact map. Loop `fetch` Bun tetap harus membuktikan driver tidak menjadi bottleneck pada setiap run.
