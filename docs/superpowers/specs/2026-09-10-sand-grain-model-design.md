# Redesign Model Pasir dan Animasi Grain

Tanggal: 2026-09-10
Status: arah desain disetujui; spesifikasi menunggu tinjauan pengguna.

## Tujuan dan Batas Lingkup

Meningkatkan detail geometri serta material empat model (castle, bunker, robot,
tank), dan mengganti scale-in/scale-out block dengan grain yang benar-benar
mengisi siluet sebelum menyatu menjadi solid. Visual menjadi prioritas utama.
Ini adalah animasi partikel dengan target geometris, bukan simulasi kontak
fisika antarbutir pasir.

Interaksi lama dipertahankan dan respons kerusakan diperjelas. Optimasi khusus
AR/mobile, perubahan layout UI, struktur baru, physics engine, dan simulasi GPU
penuh tidak termasuk iterasi ini. Koordinat tetap harus benar ketika root
ditransformasi; menunda optimasi AR bukan alasan menambahkan regresi transform.

## Konteks Saat Ini

- `sand-structures.js` memuat material, efek, lifecycle, generator, dan proyektil.
- Setiap `part` adalah mesh solid tertutup dengan pose awal dan status kerusakan.
- Build memakai scale-in dan tiga partikel dekoratif per part.
- Destroy menjatuhkan mesh utuh sambil mengecilkannya dan memicu lima partikel.
- `SandEffects` berbagi pool 450 instance untuk efek dekoratif.
- `main.js` membangun keempat struktur bersamaan pada startup.
- Tombol Bangun ulang berlaku per struktur, bukan tombol global rebuild semua.
- Klik pertama memfokuskan model; klik berikutnya menjalankan aksi model.
- Folder proyek tidak memiliki metadata Git; dokumen ini tidak di-commit.

## Pendekatan yang Dipilih

Gunakan grain bertarget volume per part dengan rendering instanced. Dibandingkan
voxel global, pendekatan ini mempertahankan hubungan grain, bagian model,
collider, dan joint. Dibandingkan simulasi GPU penuh, kompleksitas dan risiko
implementasinya lebih rendah tanpa mengurangi tujuan visual pembentukan siluet.

Part tetap menjadi unit logika kerusakan. Hanya bagian besar yang menghalangi
kerusakan lokal atau detail siluet yang dipecah lebih lanjut. Tidak setiap butir
atau ornamen perlu menjadi collider maupun unit health terpisah.

## Detail Model

Gaya tetap patung pasir basah yang dipahat, bukan plastik, logam, atau susunan
kubus voxel. Detail harus terbaca dari jarak overview dan saat Lihat dekat.

- Castle: tepian menara dan merlon tidak terlalu tajam, pola bata tidak seragam,
  bingkai gerbang berlapis, relief dinding, serta detail jembatan yang ikut joint.
- Bunker: badan bertingkat dengan kontur organik, pangkal duri yang menyatu,
  bingkai pintu, dan ventilasi berupa relief/recess tertutup.
- Robot: panel dada dan bahu, sambungan siku/lutut, jari dan telapak kaki, serta
  wajah/visor yang lebih ekspresif. Detail mengikuti joint anggota tubuh.
- Tank: lapisan hull dan turret, relief roda, mata rantai lebih jelas, serta
  cincin laras dan muzzle. Detail roda/rantai mengikuti animasi yang sama.

Bevel dan deformasi ringan memperbaiki siluet; noise shader menambah butiran,
pori, bercak lembap, serta variasi warna dan roughness. Noise warna saja tidak
cukup. Geometri harus tetap tertutup tanpa retakan antarvertex duplikat.
Permukaan patahan tidak boleh memperlihatkan shell terbuka. Detail kecil yang
menempel pada part mengikuti lifecycle part pemiliknya.

## Arsitektur

- `sand-grains.js`: modul baru untuk sampling target, alokasi instance,
  animasi grain, pembersihan per pemilik, dan disposal. Tidak mengatur health/UI.
- `sand-structures.js`: tetap memiliki generator, health, state, joint, collider,
  serta proyektil; memanggil grain system berdasarkan progress setiap part.
- `main.js`: konfigurasi kapasitas serta integrasi kontrol yang sudah ada.
  Hindari perubahan UI dan dependensi runtime baru tanpa kebutuhan nyata.
- `SandEffects`: tetap terpisah untuk debu, impact, dan serpihan aksen sehingga
  burst dekoratif tidak mengambil slot grain pembentuk struktur.

Metadata part mencakup seed deterministik, deskripsi volume, pose tersimpan,
progress transisi, dan kepemilikan grain. Grain system menerima part/pemilik,
pose, mode build atau destroy, serta waktu; mengembalikan status selesai untuk
lifecycle. Sampling dilakukan saat persiapan, bukan diulang setiap frame.

## Sampling dan Koordinat

Target harus berada di dalam atau pada permukaan bentuk sebenarnya, bukan
sekadar bounding box. Box/beveled box, cylinder/frustum/cone, sphere/ellipsoid,
dan extrusion mendapat sampling sesuai bentuk. Extrusion mengikuti kontur dan
hole sehingga gerbang tidak terisi grain. Sampling mesh tertutup dapat dipakai
untuk bentuk yang tidak memiliki representasi analitis.

Campurkan target interior dengan target dekat permukaan untuk menjaga kepadatan
volume sekaligus keterbacaan siluet. Jumlah grain mengikuti ukuran part dengan
alokasi minimum untuk detail kecil, tetap dibatasi kapasitas total.

Semua grain aktif dirender dalam koordinat lokal root milik sistem. Transform
target berasal dari inverse matrixWorld root dikalikan matrixWorld mesh, bukan
getWorldPosition yang langsung diperlakukan sebagai posisi lokal. Saat destroy,
snapshot pose aktual menyertakan turret berputar, lengan terangkat, tank bergerak,
dan skala mesh. Setelah lepas, grain tidak mengikuti gerakan joint lagi.

## Build

1. Bersihkan proyektil dan sisa grain milik struktur, pulihkan seluruh pose,
   health, dan metadata kerusakan. Struktur masuk state `building`.
2. Grain bergerak dari area dasar menuju target melalui lintasan melengkung
   dengan variasi arah dan waktu. Arah dominan tetap menuju volume part.
3. Target terisi dari bawah ke atas menurut tinggi dalam koordinat root;
   grain yang tiba menetap sebelum pemadatan. Urutan juga berlaku pada detail.
4. Solid muncul progresif pada area yang telah terisi. Gunakan reveal/dither
   per part, bukan scale-in atau perubahan opacity satu material bersama.
5. Grain pada area padat diserap bertahap. Setelah semua part selesai, mesh
   berada pada ukuran/pose penuh, tidak ada grain build tersisa, state `built`.

Durasi awal yang ditargetkan sekitar 3-5 detik per struktur, dengan overlap
antarpart. Durasi diturunkan dari waktu grain dan reveal, bukan timer lama yang
dapat menyelesaikan state terlalu dini. Tampilan shadow mengikuti reveal agar
bayangan solid tidak muncul mendahului model.

## Destroy dan Damage

Destroy dimulai dari pelepasan butiran permukaan dan aksen retak/serpihan, lalu
solid terurai bersamaan dengan grain dari volume yang sama. Jangan mengecilkan
seluruh block sebagai efek utama. Grain mendapat gravitasi, pantulan teredam,
gesekan saat menyentuh tanah, kemudian settle dan fade. Target durasi runtuh
sekitar 2-4 detik, dengan sisa grain/debu selesai maksimal sekitar 6 detik.
Tidak ada tumpukan permanen atau tabrakan antarbutir dalam iterasi ini.

Kerusakan proyektil meneruskan titik impact ke `damage(amount, hitPoint)` untuk
memilih bagian di sekitar benturan terlebih dahulu. `damage(amount)` dari tombol
tetap valid dengan prioritas bagian luar/atas. Health masih berbasis persentase;
jumlah unit kerusakan dipetakan ke part struktural, bukan semua ornamen.

Part yang mulai hancur tidak lagi menjadi collider. Part mati tidak boleh
memicu grain kedua kali saat destroy berikutnya. Transisi `destroyed` menunggu
seluruh transisi penghancuran selesai. Rebuild setelah kerusakan parsial harus
menghapus grain lama sehingga tidak muncul efek dari generasi sebelumnya.

## Interaksi dan Lifecycle

Pertahankan fokus/klik aksi, orbit/zoom, Bangun ulang, Runtuhkan, Hantam 20%,
jembatan castle, salvo bunker, pose menyerah robot, gerakan tank, putaran turret,
dan tembakan tank. Aksi hanya tersedia pada struktur `built` dengan health 100.
Build/destroy tidak dapat ditumpuk dengan panggilan berulang ketika transisi.

Kontrak state tetap `idle`, `building`, `built`, `destroying`, `destroyed`.
Grain tidak menjadi collider. Struktur yang masih dibangun tidak menerima
damage. Disposal struktur menghapus grain/proyektil miliknya; disposal sistem
membebaskan buffer, geometry, dan material tanpa menghapus milik pihak lain.

## Kapasitas dan Ketahanan

Default awal: 40.000 grain pembentuk untuk seluruh sistem; dapat dikonfigurasi
melalui opsi terpisah dari kapasitas efek dekoratif. Rentang 20.000-50.000 adalah
anggaran visual untuk evaluasi, bukan janji bahwa semua perangkat mencapainya.
Tidak ada target FPS mobile/AR pada iterasi ini.

Alokasi dibagi ke seluruh part saat persiapan, sehingga startup empat struktur
atau rebuild bersamaan tidak menimpa grain aktif struktur lain. Untuk kapasitas
kecil, kurangi kepadatan atau antrekan transisi; jangan mencuri instance aktif.
Gunakan buffer yang dapat dipakai ulang dan instance count aktif agar idle
tidak memperbarui puluhan ribu matriks tersembunyi. Hindari alokasi objek per
grain per frame. Waktu invalid/non-finite tidak boleh menghasilkan NaN.

## Verifikasi dan Kriteria Selesai

- Tes sampling deterministik: target sesuai volume, termasuk ellipsoid berskala,
  frustum, dan extrusion dengan ruang kosong; tidak ada koordinat non-finite.
- Tes lifecycle: startup empat struktur, damage parsial, destroy, rebuild,
  panggilan berulang, kapasitas kecil, serta disposal tanpa instance tertinggal.
- Tes transform: root diterjemahkan/diskalakan, joint diputar, tank dipindahkan;
  grain mulai/berakhir pada bagian yang benar dan tanah lokal yang konsisten.
- Tes impact: bagian dekat hit diprioritaskan, part mati tidak menjadi collider,
  dan health tidak dipengaruhi penambahan ornamen kosmetik.
- Jalankan `npm run build` dan tes otomatis yang ditambahkan menggunakan
  Node test runner bila tidak memerlukan browser.
- Periksa browser: tidak ada error JS/shader, empat model terbaca pada overview
  dan close-up, grain membentuk siluet sebelum solid, serta tidak ada scale pop.
- Periksa semua aksi model setelah rebuild dan penghancuran pada pose non-default.
- Ulangi build/destroy beberapa siklus; bandingkan instance aktif dan resource
  renderer untuk mendeteksi pertumbuhan tak terbatas. Catat FPS/waktu frame pada
  perangkat pengujian, tanpa menganggap build sukses sebagai bukti visual benar.
- Desktop menjadi fokus visual. Layout/kontrol mobile yang ada tidak dirusak;
  optimasi dan pengujian perangkat AR khusus tetap ditunda.

## Hasil Tinjauan Internal

Spesifikasi tidak bergantung pada simulasi fisika penuh atau perubahan UI.
Pemilik lifecycle, ruang koordinat, alokasi kapasitas, cleanup, dan hubungan
ornamen dengan damage ditentukan agar implementasi tidak saling bertentangan.
Jumlah grain dan durasi merupakan nilai awal terukur untuk tuning visual,
sedangkan pembentukan siluet dan kompatibilitas interaksi adalah syarat wajib.
