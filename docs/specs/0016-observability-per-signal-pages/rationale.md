# 0016. Catatan keputusan

Bagian ini dibaca manusia dan dibaca `/architect` saat kelak spec ini diperbarui atau digantikan. `/develop` melewatinya. Spec buildnya ada di [index.md](index.md).

## Context

> ⚠️ Catatan premis: permintaan ini terbaca sebagai satu pekerjaan tampilan, padahal di dalamnya ada satu bagian yang tidak bisa dibatalkan dengan mengembalikan satu commit, yaitu pemensiunan `observability:telemetry:read`. Pemensiunan itu bersifat serentak untuk seluruh delapan endpoint observability, karena `access.permission_user` memakai `ON DELETE CASCADE` ke `access.permission`, sehingga menghapus baris permission lama sekaligus menghapus setiap grantnya. Akibatnya cutover permission tidak bisa dijalankan halaman demi halaman mengikuti irisan UI. Bentuk yang benar: satu irisan pertama memindahkan gerbang permission di seluruh API sekaligus, lalu halaman dibangun ulang satu per satu di atas gerbang yang sudah pindah. Itulah urutan yang dipakai di `## Build plan`.

Halaman `/observability` yang dikirim spec [0014](../0014-bun-observability-benchmarking/index.md) adalah satu komponen tunggal sepanjang 283 baris di `apps/web/src/app/pages/observability/observability.page.ts`. Empat sinyal berbeda, yaitu trace, metric, benchmark, dan alert, ditumpuk sebagai tab yang dipilih lewat signal `view` di dalam komponen. Konstruktor memanggil `forkJoin` atas keempat endpoint sekaligus setiap kali halaman dibuka atau tombol Refresh ditekan, jadi seorang operator yang hanya ingin melihat alert tetap membayar query trace, metric, dan benchmark.

Bentuk itu membawa tiga masalah yang saling terkait. Pertama, tab bukan alamat. Tidak ada cara menandai halaman metric, tidak ada cara menempel tautan ke satu trace tertentu, dan tombol back peramban tidak berarti apa apa di dalam halaman. Kedua, satu permission menjaga semuanya. `observability:telemetry:read` adalah gerbang tunggal untuk kedelapan endpoint di gateway dan untuk seluruh prefix `/internal/observability/` di service logs, sehingga memberi seseorang akses ke alert berarti memberi dia akses ke seluruh evidence benchmark juga. Ketiga, kerangka halamannya berbeda sendiri dari halaman lain di aplikasi ini. Tiga halaman logs di `apps/web/src/app/pages/logs/` memakai `PageHeader`, `PageFilterToggle`, `PageFilter`, `PageContent`, dan `PageFooter` dengan paginasi di footer. Halaman observability tidak punya filter yang bisa dibuka tutup, tidak punya footer, dan tidak punya paginasi sama sekali meskipun API di belakangnya mengembalikan `nextCursor`.

Yang ketiga inilah sumber ketegangan sesungguhnya. Footer ala logs menampilkan `Page 3 of 12 · 287 records` dan empat tombol First, Previous, Next, Last, karena endpoint logs mengembalikan `meta { page, perPage, total, totalPages }`. Endpoint observability sengaja tidak seperti itu. Spec 0014 menuliskannya sebagai keputusan sadar dalam satu kalimat: list endpoint memakai cursor, bukan offset. Alasannya jelas dari bentuk datanya. `telemetry.spans` dan `telemetry.metric_buckets` adalah tabel berpartisi harian dengan retensi, dan `COUNT(*)` atas rentang waktu di tabel seperti itu adalah query yang biayanya tumbuh bersama data, persis di permukaan yang dipakai orang saat sedang menangani insiden dan paling tidak sabar menunggu. Jadi permintaan halaman nya dibuat seperti logs tidak bisa dipenuhi secara harfiah tanpa membatalkan keputusan yang sudah diratifikasi.

Ada juga celah yang belum pernah tertutup sejak 0014. `nextCursor` hanya bergerak maju, jadi tidak ada jalan mundur sama sekali. Endpoint `/api/v1/observability/benchmarks/baselines` sudah ada di gateway dan sudah dijaga permission, tapi tidak pernah punya UI. Dan `telemetry.benchmark_baselines` tidak punya index yang bisa melayani urutan cursor, karena memang tidak pernah dipaginasi.

## Options considered

### Option 1: Perbaiki di tempat, tab tetap tab

Pertahankan satu komponen, tambahkan kerangka header filter footer di sekelilingnya, dan tulis tab yang aktif ke query string supaya setidaknya bisa ditandai.

**Pros**:

- Perubahan paling kecil, tidak menyentuh API, permission, atau database sama sekali.
- Tidak ada risiko cutover permission dan tidak ada migrasi yang harus dibatalkan kalau salah.

**Cons**:

- Tidak menjawab permintaan permission per halaman sama sekali, dan permission adalah bagian yang paling sulit ditambahkan belakangan.
- `forkJoin` atas empat endpoint tetap berjalan setiap kali halaman dibuka, jadi biaya query tidak berkurang.
- Satu komponen 283 baris yang sudah padat akan tumbuh jauh lebih besar begitu enam filter panel, enam footer, dan sebuah waterfall masuk ke dalamnya.
- Detail trace dan detail benchmark tetap tidak bisa ditautkan, karena keduanya tetap state di dalam komponen.

### Option 2: Enam halaman berdiri sendiri dengan permission per sinyal

Pecah menjadi enam route di bawah `/observability`, masing masing satu komponen di atas kerangka yang sama dengan halaman logs, ditambah tiga route detail. Pecah `observability:telemetry:read` menjadi empat permission per resource, pindahkan gerbang di gateway dan di service logs, dan pensiunkan permission lama lewat satu migrasi yang menyalin grantnya lebih dulu.

**Pros**:

- Setiap sinyal punya alamat, jadi bisa ditandai, bisa ditempel ke rekan kerja, dan tombol back peramban bekerja.
- Akses mengikuti pekerjaan. Memberi seseorang alert tidak lagi otomatis memberi dia benchmark.
- Setiap halaman hanya memanggil endpointnya sendiri, jadi biaya query per kunjungan turun jauh dibanding `forkJoin` empat arah.
- Seragam dengan tiga halaman logs, sehingga tidak ada kerangka halaman kedua yang harus dirawat terpisah.

**Cons**:

- Cutover permission serentak dan tidak bisa dibatalkan dengan mengembalikan satu commit. Butuh migrasi turun yang benar dan langkah pengosongan cache yang eksplisit.
- Enam komponen lebih banyak file dan lebih banyak duplikasi kerangka dibanding satu komponen.
- Menambah pekerjaan nyata di `observability.repository.ts` untuk keyset dua arah, di permukaan yang sudah 875 baris.

### Option 3: Enam halaman, tapi permission dibiarkan satu

Pecah routenya saja, `observability:telemetry:read` tetap menjaga keenam halaman.

**Pros**:

- Mendapat seluruh keuntungan alamat dan kerangka tanpa satu pun risiko migrasi.
- Bisa dikirim dalam satu rilis tanpa koordinasi apa pun.

**Cons**:

- Tidak menjawab bagian permintaan yang paling eksplisit.
- Menambahkan permission per halaman belakangan justru lebih mahal, karena saat itu sudah ada enam halaman, enam gerbang route, enam item navigasi, dan sekumpulan test yang semuanya harus disentuh ulang.

## Rationale

Option 2 dipilih. Yang menentukan adalah biaya menunda, bukan biaya mengerjakan. Permission adalah bagian yang paling murah dipindahkan sekarang dan paling mahal dipindahkan nanti: hari ini ada satu halaman, satu gerbang route, satu item navigasi, dan satu pemetaan prefix di `apps/services/logs/src/app.ts` yang harus diubah. Setelah enam halaman berdiri, jumlah tempat yang harus disentuh untuk pekerjaan yang sama menjadi enam kali lipat, dan setiap tempat itu punya testnya sendiri. Itulah alasan Option 3 ditolak meskipun terlihat paling aman.

Ketegangan antara footer ala logs dan cursor diselesaikan dengan memenangkan bentuk data, bukan bentuk tampilan. Cursor dipertahankan karena alasan yang membuat 0014 memilihnya masih berlaku persis: `telemetry.spans` dan `telemetry.metric_buckets` berpartisi harian dengan retensi, dan `COUNT(*)` atas rentang waktu di tabel seperti itu tumbuh bersama data di permukaan yang justru dipakai saat orang paling tidak sabar. Yang berubah adalah cursornya jadi dua arah. `prevCursor` dipilih di atas alternatif yang lebih murah, yaitu menyimpan tumpukan cursor di klien, karena state paginasi ditulis ke query string. Tumpukan di klien akan hilang setiap reload dan setiap kali tautan dibuka orang lain, sehingga tombol Previous akan bekerja atau tidak tergantung bagaimana halaman itu dicapai. Perilaku yang bergantung pada cara mencapainya adalah perilaku yang akan dilaporkan sebagai bug. Harganya jujur: satu query tambahan per request dan keyset dua arah di repository.

Halaman Metrics sengaja tidak dipaginasi meskipun lima halaman lain dipaginasi. Isinya adalah ember waktu yang sudah terikat jendela maksimum 24 jam dan batas `maxSeries`, jadi memaginasinya berarti memotong sumbu waktu sebuah grafik menjadi beberapa halaman, dan itu membuat grafiknya berbohong. Baselines justru sebaliknya: satu baris per versi skenario yang dipromosikan, tumbuh selamanya tanpa retensi, jadi dia memang perlu cursor sejak hari pertama plus index yang menopangnya.

Aturan ember hilang bukan nol dari 0014 diperluas ke grafik, bukan dilonggarkan. Grafik menggambar garis yang benar benar terputus dan pita abu abu di rentang yang tidak punya data, karena satu satunya alasan blok `coverage` ada di response adalah supaya cakupan yang bolong tidak pernah terbaca sebagai nilai nol. Grafik yang menyambungkan garis melewati celah akan membatalkan seluruh maksud itu dengan satu keputusan tampilan.

Satu preferensi engineer sengaja diikuti meskipun rekomendasi awal berbeda. Untuk navigasi, rekomendasi adalah item `collapsible` dengan enam anak, karena kata submenu ada di permintaan aslinya dan library `@ojiepermana/angular-navigation` memang mendukung `type: 'collapsible'` dengan `children`. Engineer memilih grup datar berisi enam item, sama seperti grup Logs. Pilihan itu diterima dan konsekuensinya harus disadari: sidebar bertambah enam baris sekaligus, dan grup Observability akan jadi grup terpanjang di seluruh navigasi. Kalau nanti terasa terlalu panjang, mengubahnya jadi `collapsible` adalah perubahan satu fungsi di `app.nav.ts` dan tidak menyentuh route mana pun.
