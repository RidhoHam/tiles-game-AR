# AR Perang Pasir Berbasis Kartu (Webcam Desktop)

Tanggal: 2026-09-11
Status: **diimplementasikan** - seluruh rencana telah dikerjakan; build hijau dan tes lulus. Lihat "Hasil implementasi" di akhir dokumen untuk rincian yang terverifikasi dan yang belum.

## Tujuan

Mengubah proyek `spongebob-sand-war` menjadi **augmented reality sungguhan**
yang berjalan di komputer dengan webcam mengarah ke meja. Pemain mencetak enam
kartu, meletakkannya di meja, dan menonton pertarungan pasir terjadi di atas
kartu-kartu itu.

Ini bukan simulasi dan bukan permainan layar penuh. Kartu fisik adalah jangkar
dunia nyata; objek 3D muncul menempel pada kartu dan bergerak di permukaan meja.

## Batasan Platform (Mengikat)

Rilis ini ditargetkan pada **Chrome desktop dengan webcam**, bukan perangkat AR.

- WebXR `immersive-ar` **tidak tersedia di browser desktop**. Karena itu mode
  markerless, hit-test, reticle, dan penempatan arena berbasis WebXR
  **dikeluarkan dari rilis ini** dan dicabut dari antarmuka.
- Tidak ada permintaan: mode "Markerless Table AR" dan mode "Preview Desktop"
  dihapus dari pemilihan mode. Hanya satu pengalaman: AR kartu.
- Pelacakan gambar memakai MindAR lewat feed webcam biasa, tanpa WebXR.
- Halaman harus tetap dilayani melalui HTTPS atau localhost karena permintaan
  kamera memerlukan secure context.

## Keputusan yang Disetujui

| Topik | Keputusan |
| --- | --- |
| Platform | Chrome desktop + webcam |
| Mode AR | Hanya marker-based (kartu) |
| Markerless | Dikeluarkan dari rilis |
| Jumlah kartu | 6 total: 3 per sisi |
| Urutan kartu | Bebas, tidak ada aturan urutan |
| Penentuan tim | Posisi kartu relatif terhadap garis tengah |
| Komposisi tim | Wajib 1 base + 1 artileri + 1 prajurit |
| Bentuk kartu | A4 siap potong, bingkai berfitur tinggi |
| Peran garis panduan | Panduan visual saja, bukan acuan koordinat |
| Aturan pertarungan | Peran menentukan perilaku |
| Tampilan HP | HP bar 3D menempel di atas unit |
| Peran pemain | Hanya menonton setelah kartu diletakkan |
| AR session | Satu bidang arena bersama, dikalibrasi dari kartu |

## Peran Kartu dan Unit

Enam kartu dibagi tiga peran, masing-masing dua pilihan:

| Peran | Kartu | Health | Damage | Jangkauan | Perilaku |
| --- | --- | --- | --- | --- | --- |
| base | Benteng, Bunker | 200 | 0 | - | Diam di kartunya, tidak menyerang |
| artileri | Robot, Tank | 120 / 100 | 16 / 20 | jauh | Berhenti di jarak tembak lalu menembak |
| prajurit | Kesatria Kuda, Gargoyle | 70 / 60 | 14 / 12 | dekat | Maju menempel target lalu menyerang |

- Kartu **tidak bergerak** selama battle. Kartu adalah markas dan titik asal.
- Setiap unit muncul di atas kartunya, lalu berjalan keluar meninggalkan kartu.
- Unit bergerak di **satu bidang arena bersama** di antara kedua kelompok kartu.
  Karena itu posisi unit tidak boleh menjadi anak dari container kartu; arena
  adalah ruang bersama yang dikalibrasi dari posisi kartu yang terdeteksi.
- Serangan bersifat dua arah: unit menyerang dan juga menerima serangan.

## Alur Pengalaman

1. **Mulai.** Halaman meminta izin kamera dan menampilkan feed webcam.
2. **Panduan.** Tiga garis panduan digambar di layar: satu garis tengah vertikal
   dan dua garis vertikal di kiri/kanan yang lebarnya seukuran satu kartu.
   Garis-garis ini murni panduan visual; pelacakan tetap sepenuhnya dari MindAR.
3. **Peletakan kartu.** Pemain meletakkan tiga kartu di kiri dan tiga di kanan,
   dalam urutan bebas. Aplikasi mengenali jenis setiap kartu yang terdeteksi.
4. **Penentuan tim.** Kartu yang berada di separuh kiri bidang pandang masuk
   Tim Biru; separuh kanan masuk Tim Merah.
5. **Validasi.** Setiap tim wajib memiliki tepat satu base, satu artileri, dan
   satu prajurit. Bila belum, aplikasi menampilkan pesan spesifik dan battle
   tidak dimulai. Kartu di luar zona, kartu ganda, dan kartu tak dikenal juga
   dilaporkan.
6. **Mulai battle.** Setelah enam kartu valid dan stabil, battle berjalan
   otomatis.
7. **Menonton.** Pemain tidak memiliki aksi apa pun selama battle. Aplikasi
   menyediakan tombol mengulang setelah battle selesai.

## Pergerakan dan Pertarungan

- Setiap unit memiliki fase: `muncul` di atas kartunya, `berjalan keluar`
  meninggalkan kartu, `maju` ke arah musuh, `menyerang`, `terkena`, `runtuh`,
  dan `hancur`.
- Artileri berhenti pada jarak tembak dan menembakkan proyektil pasir.
- Prajurit terus maju sampai menempel pada target lalu menyerang jarak dekat.
- Base tidak menyerang; base hanya menerima serangan sampai hancur.
- Unit memilih target berdasarkan **peran menentukan perilaku**: unit menyerang
  target hidup terdekat yang berada dalam jangkauannya. Bila tidak ada target
  dalam jangkauan, unit maju ke arah base musuh.
- Setiap unit dapat menjadi penyerang dan sasaran pada waktu yang sama.
- Pertarungan berakhir ketika salah satu base hancur.
- Keputusan pertarungan harus deterministik agar hasil dapat diuji dan diulang.

## Kebutuhan Aset Kartu

- Enam gambar kartu sumber: `benteng`, `bunker`, `robot`, `tank`, `kesatria`,
  `gargoyle`.
- Setiap kartu memuat: bingkai bermotif dengan banyak sudut dan kontras tinggi,
  ilustrasi unit, nama unit, dan label perannya. Bingkai harus tidak simetris
  agar orientasi kartu dapat ditentukan.
- Satu lembar A4 berisi keenam kartu dengan tanda potong.
- Berkas keluaran: gambar kartu individual, lembar A4 siap cetak, dan berkas
  target terkompilasi untuk runtime pelacakan gambar.
- Berkas target dan gambar kartu disajikan sebagai aset publik aplikasi.

## Kalibrasi Arena

- Arena adalah satu bidang bersama yang diturunkan dari posisi kartu yang
  terdeteksi, bukan dari setiap kartu secara terpisah.
- Garis tengah arena adalah garis pemisah antara kartu kiri dan kartu kanan.
- Ukuran arena mengikuti jarak nyata antar kartu, sehingga unit berjalan pada
  skala yang masuk akal di atas meja.
- Bila jumlah kartu yang terdeteksi berubah sebelum battle dimulai, arena
  dihitung ulang. Setelah battle berjalan, arena tidak boleh berubah agar unit
  tidak melompat.

## Tampilan

- **HP bar 3D** melayang di atas setiap model, berwarna biru untuk Tim Biru dan
  merah untuk Tim Merah, dengan nama unit di dekatnya.
- HP bar harus selalu menghadap kamera dan tetap terbaca saat model bergerak.
- Tidak ada panel HTML permanen di atas feed kamera. Status pertandingan
  disampaikan lewat HP bar, label unit, dan efek visual.
- Efek visual: kemunculan pasir, jejak jalan, kilatan proyektil, hantaman,
  keruntuhan menjadi pasir, dan penanda target.

## Audio

- Musik latar dan efek suara tetap memakai sistem Strudel yang sudah ada.
- Efek suara peristiwa: unit muncul, berjalan, menyerang, menembak, terkena
  hantaman, hancur, base hancur, dan kemenangan.
- Audio baru aktif setelah interaksi pengguna dan kegagalan audio tidak fatal.

## Arsitektur

Struktur berlapis yang sudah ada dipertahankan:

```text
src/core/   → domain murni: statistik unit, komposisi tim, pertarungan, RNG
src/scene/  → model pasir, struktur, grain, efek, HP bar
src/ar/     → pelacakan kartu dan kalibrasi arena
src/audio/  → musik dan efek suara
src/ui/     → layar dan komponen
src/app/    → bootstrap dan orkestrasi
```

Aturan dependensi satu arah tetap berlaku. `src/core/` tidak boleh mengimpor
Three.js, DOM, atau library pelacakan.

Perubahan utama:

- `src/core/` menerima model pertarungan baru berbasis peran dan posisi, bukan
  lagi berbasis prioritas war-machine dan aturan summon.
- `src/ar/` menjadi adapter pelacakan kartu sungguhan yang memuat berkas target,
  melaporkan enam jenis kartu beserta pose, dan menghitung kalibrasi arena.
- `src/scene/` mendapat komponen HP bar 3D dan pergerakan unit di bidang arena.
- `src/ui/` menyusut: pemilihan mode, roster, dan layar summon dihapus karena
  kartu fisik menggantikan semua itu.

## Yang Dihapus dari Rilis Sebelumnya

- Mode markerless, WebXR, hit-test, reticle, dan `ar-markerless.js`.
- Layar pemilihan mode dan layar roster berbasis dropdown.
- Aturan summon, cooldown delapan detik, dan tombol reinforcement.
- Mode Preview Desktop sebagai jalur terpisah.

## Penanganan Kesalahan

- Izin kamera ditolak, runtime pelacakan gagal dimuat, berkas target tidak
  ditemukan, kartu tidak terdeteksi, komposisi tim tidak valid, dan dua kartu
  identik pada satu tim semuanya menjadi pesan yang jelas dan dapat dipulihkan.
- Kehilangan pelacakan sebelum battle dimulai hanya menghentikan validasi,
  bukan merusak state. Kehilangan pelacakan setelah battle berjalan tidak boleh
  menghentikan pertarungan; arena tetap memakai kalibrasi terakhir.

## Pengujian

- Tes domain murni di Node: pencocokan jenis kartu, penentuan tim berdasarkan
  sisi, validasi 1 base + 1 artileri + 1 prajurit, pemilihan target berdasarkan
  peran dan jarak, penerimaan serangan dua arah, determinisme, dan simulasi
  pertarungan penuh sampai salah satu base hancur.
- Tes komponen HP bar untuk pemetaan health ke lebar dan warna tim.
- `npm test` dan `npm run build` harus lolos.
- Uji manual dengan webcam: cetak lembar kartu, letakkan tiga kartu per sisi,
  pastikan model menempel pada kartu, unit berjalan keluar, bertarung di antara
  kartu, dan menghancurkan base musuh.

## Di Luar Lingkup

- Markerless dan WebXR.
- Paritas perangkat seluler.
- Multiplayer jaringan, akun, dan papan skor.
- Pemain mengendalikan unit selama battle.
- Fisika butir pasir yang akurat dan optimasi frame-rate perangkat.

## Risiko yang Diakui

- Kualitas pelacakan MindAR bergantung pada pencahayaan, fokus webcam, dan mutu
  cetakan. Ini tidak dapat diverifikasi tanpa perangkat fisik, sehingga kartu
  harus diuji oleh pengguna sebelum dianggap selesai.
- Bila webcam tidak dapat melihat keenam kartu sekaligus, arena harus dibangun
  dari kartu yang terlihat pada saat yang sama; ini membatasi ukuran meja.
- Skala model pasir yang ada perlu disesuaikan agar proporsional dengan ukuran
  kartu nyata.

## Hasil implementasi

Status di atas ("diimplementasikan") dicatat pada 2026-09-11 setelah Task 10
(verifikasi akhir dan dokumentasi). Rincian verifikasi:

**Terverifikasi di lingkungan pengembangan:**

- `npm test` lulus: **243 tes, 0 gagal** (17 berkas tes, Node test runner).
- `npm run build` (Vite 7) sukses dengan status keluar 0; aset hasil build
  tercatat di `dist/` (HTML, CSS, dan tiga chunk JS termasuk runtime MindAR).
- Aturan dependensi terjaga: `src/core/` tidak mengimpor `three`, tidak memakai
  impor relatif keluar folder, dan tetap murni sehingga dapat diuji di Node.
- Aset kartu lengkap di `public/cards/`: enam SVG kartu, `lembar-a4.svg`, dan
  `README.md`; semuanya tersalin ke `dist/cards/` saat build.
- Berkas lama dari rilis sebelumnya (`ar-markerless`, `summon-zone`,
  `screen-mode`, `screen-roster`, `screen-placement`, `screen-build`) sudah
  tidak ada dan tidak ada modul yang mengimpornya.
- Lembar A4 kini dihasilkan oleh `scripts/build-card-sheet.mjs` (menutup celah
  I1 Task 3): mengubah kartu lalu menjalankan skrip menyinkronkan lembar A4,
  sehingga tidak ada lagi risiko lembar melenceng diam-diam.
- `README.md` tingkat atas dan catatan pembuatan lembar di
  `public/cards/README.md` tersedia.

**Belum terverifikasi (memerlukan perangkat fisik):**

- **Cetak fisik kartu** - skala hasil cetak, ketebalan garis, dan ketajaman
  cetakan tidak dapat diperiksa dari kode.
- **Pelacakan webcam sungguhan** - pencahayaan, fokus, dan jarak kamera di
  ruangan nyata hanya terbukti saat kartu benar-benar dicetak dan diarahkan ke
  meja.
- **Berkas target `public/cards/targets.mind` disediakan oleh pengguna** - MindAR
  tidak memiliki compiler Node, sehingga berkas ini harus dikompilasi manual di
  browser dan tidak ada di repositori. Urutan unggah enam kartu
  (`benteng`, `bunker`, `robot`, `tank`, `kesatria`, `gargoyle`) menentukan
  indeks target dan tidak dapat diverifikasi dari kode.