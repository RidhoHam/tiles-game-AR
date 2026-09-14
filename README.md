# Perang Benteng Pasir AR (Kartu + Webcam)

Pertarungan pasir **augmented reality berbasis kartu** yang berjalan di **Chrome desktop
dengan webcam**. Kamu mencetak **enam kartu**, meletakkan **tiga kartu di kiri** dan **tiga
kartu di kanan** meja, lalu **menonton** pertarungan pasir terjadi di atas mejamu.

Ini **bukan** permainan layar penuh dan **bukan** simulasi. Kartu fisik adalah jangkar
dunia nyata: model 3D unit muncul menempel pada kartunya, lalu berjalan keluar dan
bertempur di tengah meja.

> **Pemain hanya menonton.** Setelah kartu diletakkan dan "Mulai Battle" ditekan,
> pertarungan berjalan otomatis. Tidak ada tombol menyerang, tidak ada summon, dan tidak
> ada kontrol unit selama battle. Satu-satunya aksi setelahnya adalah mengulang.

---

## 1. Kebutuhan

| Kebutuhan | Keterangan |
| --- | --- |
| Browser | **Chrome Desktop** atau browser **Mobile (Chrome/Safari di HP)** melalui HTTPS Ngrok Tunnel. |
| Kamera | **Webcam laptop/PC** atau **kamera belakang smartphone (rear camera)** yang diarahkan ke meja. |
| Node.js + npm | Untuk menjalankan server pengembangan dan build. Node 20+ disarankan. |
| Konteks aman | Akses kamera **hanya** diizinkan di *secure context* (HTTPS atau `http://localhost`). Untuk bermain di HP, gunakan skrip `npm run tunnel` yang menyediakan link HTTPS otomatis via Ngrok. |
| Kartu cetak | Enam kartu dari `public/cards/lembar-a4.svg`, dicetak di kertas A4 atau ditampilkan di layar monitor. |
| Berkas target | 6 berkas `.mind` kartu individual sudah tersedia di `public/cards/` (`BENTENG.mind`, `BUNKER.mind`, `ROBOT.mind`, `TANK.mind`, `KESATRIA.mind`, `GARGOYLE.mind`) dan digabungkan otomatis saat runtime. |

---

## 2. Cara Menjalankan

### Opsi A: Bermain di Laptop / PC (Webcam)
```bash
npm install     # pasang dependensi (sekali saja)
npm run dev     # jalankan server pengembangan Vite
```
1. Buka URL `http://localhost:5173/` di **Chrome desktop**.
2. Klik **"Aktifkan Kamera"** dan **izinkan akses kamera**.
3. Arahkan kamera ke meja berisi kartu fisik, tunggu kartu terdeteksi, dan mulai bermain.

### Opsi B: Bermain di Smartphone / HP (Ngrok Tunnel + QR Code)
Untuk pengalaman bermain terbaik menggunakan kamera smartphone:
```bash
npm run tunnel  # menjalankan dev server + ngrok tunnel + QR Code terminal
```
1. Skrip akan mendeteksi `ngrok.exe` (di Desktop atau PATH), membuat tunnel HTTPS, dan mencetak **QR Code di terminal**.
2. **Pindai QR Code** langsung menggunakan kamera / pemindai barcode di smartphone Anda.
3. Buka tautan HTTPS yang muncul di Chrome / Safari mobile, lalu **izinkan akses kamera**.
4. Posisikan smartphone dalam orientasi **Landscape (Mendatar)** untuk area pandang meja yang lebih luas.

---

## 3. Fitur Utama Pengalaman Mobile AR

1. **Anti-Tremor & Card Persistence**:
   - Deteksi kartu dikunci (*latched*) sehingga saat tangan bergoyang (*tremor*) atau kamera bergeser sesaat, **model 3D tidak akan hilang atau berkedip**.
   - Model 3D tetap berdiri di atas kartu dan posisinya dapat diperbarui secara mulus saat kartu digeser.
2. **Indikator Semua Model Siap (Ready Status)**:
   - Setiap model memiliki cincin alas proyeksi 3D di atas kartu.
   - Saat seluruh kartu tim telah siap, cincin berubah menjadi **Hijau Neon Glowing** dan muncul banner `SEMUA MODEL SIAP!`.
3. **Hitung Mundur Otomatis 3 Detik (Hands-Free)**:
   - Begitu model siap, sistem otomatis menghitung mundur `3... 2... 1...` lalu langsung memulai pertempuran secara otomatis tanpa perlu menyentuh layar HP.
4. **Unit Tempur Bergerak Keluar Dari Kartu**:
   - Bangunan basis (**Benteng Pasir** & **Bunker Berduri**) tetap bertahan di atas kartu fisik di tepi arena.
   - Prajurit dan artileri (**Kesatria**, **Gargoyle**, **Robot**, **Tank**) muncul di atas kartu lalu **berjalan maju keluar dari kartu (`walkTo`)** menuju arena pertempuran pasir.
5. **Quick Action Bar**:
   - Tombol melayang di layar: **Mode (Battle / Test)**, **Masuk Posisi** (merapikan barisan agar tidak berdempetan), **Mulai Battle**, dan **Ciutkan Panduan**.
6. **Kombinasi Kartu Bebas (Random)**:
   - Mendukung pertarungan acak 1v1 (duel prajurit), 2v1, 2v2, hingga 3v3 asimetris dengan kondisi kemenangan dinamis.

---

## 4. Berkas Target Kartu (.mind)

Aplikasi menggunakan 6 berkas target individual berformat MindAR di dalam folder `public/cards/`:
- `BENTENG.mind`
- `BUNKER.mind`
- `ROBOT.mind`
- `TANK.mind`
- `KESATRIA.mind`
- `GARGOYLE.mind`

`CardTrackingController` secara otomatis memuat keenam berkas tersebut secara paralel saat runtime dan menggabungkannya ke dalam satu `Blob URL` multi-track berformat MessagePack, sehingga MindAR dapat melacak seluruh kartu sekaligus dengan cepat dan stabil.

### 4.1 Cetak Kartu

1. Buka **`public/cards/lembar-a4.svg`** di browser.
2. Cetak (**Ctrl+P**) dengan setelan:
   - Kertas **A4**, orientasi **potret**.
   - **Skala 100%** - **JANGAN** pilih "Fit to page" / "Shrink to fit" / "Pas ke halaman".
     Penskalaan mengubah ukuran kartu dan melemahkan pelacakan.
3. Setelah dicetak, **ukur satu kartu**: tinggi harus sekitar **90 mm** dan lebar sekitar
   **63,5 mm**. Bila tidak, cetak ulang pada skala 100%.
4. Potong mengikuti garis putus-putus.

**Ukuran harus konsisten.** Berkas target dikompilasi dari gambar pada ukuran tertentu; bila
hasil cetak berskala berbeda, pose 3D akan meleset dan model tampak "melayang"/bergetar.
Cetak semua kartu dari lembar yang sama.

### 3.2 Kompilasi `targets.mind`

MindAR **tidak menyediakan compiler untuk Node.js**. Berkas target harus dikompilasi sekali
secara manual memakai Image Target Compiler milik MindAR di browser:

1. Buka **<https://hiukim.github.io/mind-ar-js-doc/tools/compile>** di Chrome.
   (Berjalan sepenuhnya di browser; tidak ada gambar yang diunggah ke server.)
2. Seret **keenam** berkas SVG dari `public/cards/` ke area unggah, **TEPAT DALAM URUTAN
   INI**:

   | Urutan | Berkas | Peran |
   | ---: | --- | --- |
   | 1 | `benteng.svg` | base |
   | 2 | `bunker.svg` | base |
   | 3 | `robot.svg` | artileri |
   | 4 | `tank.svg` | artileri |
   | 5 | `kesatria.svg` | prajurit |
   | 6 | `gargoyle.svg` | prajurit |

3. Tunggu semua gambar selesai diproses, lalu klik **Download**.
4. Simpan hasil unduhan dengan nama **`targets.mind`** di:

   ```text
   public/cards/targets.mind
   ```

5. Verifikasi dari terminal:

   ```bash
   node scripts/build-targets.mjs
   ```

   Skrip ini tidak mengompilasi apa pun; ia memeriksa gambar sumber dan keberadaan berkas
   target, lalu memberi instruksi. Bila `targets.mind` sudah ada, skrip keluar dengan kode 0.

> ### ⚠️ URUTAN KARTU MENENTUKAN INDEKS TARGET
>
> Urutan unggah menetapkan **indeks target** (0..5), dan indeks itu dipetakan ke tipe unit
> oleh `src/ar/card-targets.js`. **Urutan yang salah akan memetakan kartu ke tipe unit yang
> salah secara diam-diam** - tidak ada peringatan, permainan hanya menjadi salah
> (misalnya kartu Benteng muncul sebagai Robot). Jadi urutannya wajib:
>
> **`benteng`, `bunker`, `robot`, `tank`, `kesatria`, `gargoyle`**
>
> Urutan susunan kartu di meja tetap bebas; yang **tidak** bebas adalah urutan saat
> mengompilasi berkas target.

> Catatan: setelah mengubah gambar kartu, kamu juga harus **membuat ulang lembar A4**
> (`node scripts/build-card-sheet.mjs`) dan **mengompilasi ulang `targets.mind`**.

---

## 4. Panduan cetak

- Cetak **`public/cards/lembar-a4.svg`** pada kertas A4, **skala 100%**, tanpa "fit to page".
- Ukuran satu kartu setelah dipotong: **63,53 x 90 mm** (perbandingan 600:850). Upayakan
  tinggi ± **9 cm**.
- **Ukuran yang konsisten itu penting**: kartu yang lebih kecil/besar dari ukuran sumber
  membuat pose 3D meleset. Bila ragu, ukur dengan penggaris.
- Kertas **matte/biasa** lebih baik daripada glossy/reflektif.
- Lembar A4 ini **dihasilkan otomatis** oleh `scripts/build-card-sheet.mjs` dari keenam
  berkas kartu. Jangan menyuntingnya manual; jalankan skrip itu setelah mengubah kartu.

---

## 5. Aturan peletakan kartu

- **Tiga kartu per sisi**: tiga di kiri, tiga di kanan.
- **Urutan bebas** - boleh disusun sesuka hati.
- **Komposisi wajib per sisi**: tepat **satu base**, **satu artileri**, dan **satu
  prajurit**.
- **Sisi ditentukan oleh posisi** kartu relatif terhadap **garis tengah** meja:
  pusat kartu di kiri garis tengah = tim **Biru**, di kanan = tim **Merah**. Kartu yang
  tepat berada di garis tengah ditolak.
- **Tiga garis panduan** (kiri/tengah/kanan) di layar hanyalah **alat bantu visual**;
  yang benar-benar menentukan tim adalah posisi fisik kartu, bukan garis-garis itu.

---

## 6. Pencahayaan & pembingkaian

Pelacakan gambar bergantung pada kontras. Agar kartu terbaca stabil:

- Gunakan **cahaya rata dan menyebar** (diffuse). Lebih baik beberapa sumber cahaya
  ruangan daripada satu lampu sorot.
- **Hindari kilau (glare)** dan pantulan langsung dari lampu atau jendela ke atas kertas.
- **Hindari bayangan keras**, terutama bayangan tangan, kepala, atau badan kamera tepat di
  atas kartu.
- **Hindari meja gelap atau reflektif.** Meja putih/abu-abu matte memberi kontras terbaik.
- **Pastikan keenam kartu terlihat sekaligus** dalam satu bingkai. Kamera boleh dari atas
  (overhead) ataupun menyerong dari depan meja, selama semua kartu masuk gambar.
- Jangan biarkan kartu tertutup tangan dan jangan menggoreskan/memindahkan kartu saat
  battle berlangsung.

Topik ini dibahas lebih rinci di `public/cards/README.md`.

---

## 7. Daftar unit

Tiga peran: **base** (tidak menyerang, hanya bertahan), **artileri** (menembak dari jarak
jauh), **prajurit** (maju mendekat lalu bertarung jarak dekat). Setiap sisi wajib punya
tepat satu dari masing-masing peran.

| Unit | Peran | Health | Damage | Range | Speed |
| --- | --- | ---: | ---: | ---: | ---: |
| Benteng Pasir | base | 200 | 0 | 0 | 0 |
| Bunker Berduri | base | 200 | 0 | 0 | 0 |
| Robot Pasir | artileri | 120 | 16 | 3,2 | 1,1 |
| Tank Pasir | artileri | 100 | 20 | 3,8 | 0,9 |
| Kesatria Pasir | prajurit | 70 | 14 | 1,1 | 2,2 |
| Gargoyle Pasir | prajurit | 60 | 12 | 1,4 | 2,6 |

Keterangan:

- **base** - damage 0 dan range 0, jadi **tidak menyerang** dan **tidak berpindah**
  (speed 0). Base hanyalah target yang harus dilindungi.
- **artileri** - range jauh (3,2-3,8) dan damage besar, tetapi bergerak lambat. Berhenti
  pada jarak tembaknya dan menembak dari sana.
- **prajurit** - health lebih kecil tetapi cepat. Maju sampai jarak dekat (1,1-1,4) lalu
  menyerang.

Angka-angka di atas diambil langsung dari `src/core/unit-definitions.js`. Unit juga punya
`attackInterval` (jeda antar serangan dalam detik simulasi) yang menjaga hasil pertarungan
tetap sama berapa pun frame rate-nya.

---

## 8. Cara kerja battle

- **Otomatis.** Setelah "Mulai Battle" ditekan, unit berjalan keluar dari kartunya, mencari
  sasaran terdekat, dan bertempur tanpa masukan pemain.
- **Berakhir saat salah satu base hancur.** Layar hasil menampilkan pemenang
  (**Tim Biru menang** / **Tim Merah menang**).
- **Bisa diulang** lewat tombol **"Ulangi"** (kembali memindai kartu tanpa meminta izin
  kamera lagi). Ada juga **"Pindai Ulang Kartu"**.
- **Deterministik**: komposisi dan posisi kartu yang sama selalu menghasilkan pertarungan
  yang sama.

---

## 9. Perintah

| Perintah | Kegunaan |
| --- | --- |
| `npm install` | Memasang dependensi. |
| `npm run dev` | Menjalankan server pengembangan Vite (untuk Chrome desktop). |
| `npm run tunnel` | **Menjalankan tunnel Ngrok HTTPS + QR Code** untuk bermain di smartphone / HP. |
| `npm test` | Menjalankan seluruh tes Node (293 tes). |
| `npm run build` | Build produksi ke `dist/`; folder `public/cards/` ikut tersalin ke `dist/cards/`. |
| `npm run preview` | Melayani hasil build untuk pemeriksaan. |
| `node scripts/build-card-sheet.mjs` | **Membuat ulang `public/cards/lembar-a4.svg`** dari keenam kartu. |
| `node scripts/build-targets.mjs` | Memeriksa gambar kartu & keberadaan berkas target `.mind`. |

---

## 10. Troubleshooting

### Muncul pesan bahwa berkas target tidak ada / tidak bisa dibaca

Aplikasi akan menampilkan pesan seperti *"Berkas target '/cards/targets.mind' tidak
ditemukan (HTTP 404)..."*.

- **Penyebab paling umum:** `public/cards/targets.mind` belum dibuat.
- **Solusi:** ikuti bagian 3.2 di atas untuk mengompilasi berkas target, lalu letakkan di
  `public/cards/targets.mind` dan muat ulang halaman.
- Bila pesannya menyebut berkas *"ada tetapi tidak bisa dibaca sebagai target MindAR"*,
  kompilasinya gagal/rusak. Kompilasi ulang keenam gambar, lalu ganti berkasnya.
- Bila muncul *"Paket MindAR belum terpasang"*, jalankan `npm install` lalu muat ulang.

### Kamera tidak bisa dibuka (izin ditolak)

Chrome akan menampilkan pesan bahwa *"Akses kamera ditolak atau gagal..."*.

- Klik ikon kamera/gembok di address bar Chrome dan **izinkan kamera** untuk situs ini, lalu
  **muat ulang halaman**.
- Pastikan halaman dibuka lewat **`http://localhost:...`**, bukan alamat IP LAN
  (IP LAN bukan konteks aman, sehingga kamera selalu diblokir).
- Tutup aplikasi lain (Zoom, Teams, dsb.) yang mungkin sedang memakai webcam.

### Kartu tidak terdeteksi

- **Pencahayaan:** tambah cahaya rata, hilangkan kilau dan bayangan keras.
- **Fokus:** pastikan kamera fokus ke meja; jangan terlalu dekat atau terlalu jauh.
- **Skala cetak:** ukur kartu - harus sekitar 63,5 x 90 mm. Cetak ulang pada skala 100%
  bila tidak.
- **Urutan target:** pastikan keenam kartu dikompilasi dengan urutan yang benar (bagian 3.2).
- **Bingkai:** pastikan keenam kartu masuk gambar sekaligus dan tidak tertutup tangan.
- **Latar:** hindari meja gelap atau reflektif.
- Aplikasi memerlukan **keenam** kartu terdeteksi sebelum "Mulai Battle" aktif; layar pindai
  menandai kartu mana yang belum terbaca dan menyebutkan kesalahan komposisi tim.

### Kartu terbaca tetapi Battle tidak bisa dimulai

Layar pindai mencantumkan kesalahan komposisi. Yang paling sering: satu sisi tidak punya
tepat satu base / artileri / prajurit, atau ada kartu yang berada tepat di garis tengah.
Perbaiki susunannya (bagian 5), atau tekan "Pindai Ulang".

### Model tampak melayang atau bergetar

Biasanya karena ukuran cetak tidak sama dengan gambar sumber, atau karena kartu bergerak saat
pelacakan. Cetak ulang pada skala 100% dan jangan menggeser kartu saat battle.

> **Catatan penting:** kualitas pelacakan bergantung pada **hasil cetak fisik dan
> pencahayaan** di ruanganmu. Hal ini **tidak bisa diverifikasi dari kode** - ia baru
> terbukti saat kamu benar-benar mencetak kartu dan mengarahkan webcam ke meja.

---

## 11. Struktur proyek

Proyek disusun berlapis. Lapisan inti (domain) murni dan tidak bergantung pada Three.js,
DOM, maupun pustaka pelacakan - itu sebabnya ia bisa diuji di Node.

| Folder | Isi |
| --- | --- |
| `src/core` | **Domain murni** (tanpa Three.js/DOM): definisi unit, komposisi tim, tata letak arena, medan & sistem pertarungan, RNG. |
| `src/scene` | **Three.js**: arena, garis panduan, HP bar/label unit, efek pasir, animasi pergerakan, pustaka model unit. |
| `src/ar` | **Pelacakan kartu**: pembungkus MindAR, pemetaan indeks target ke tipe unit, deteksi kapabilitas, shim kompatibilitas Three.js. |
| `src/audio` | **Audio**: pemetaan event battle ke efek suara. |
| `src/ui` | **UI**: state aplikasi, wizard layar, layar kamera/pindai/battle/hasil, komponen kecil. |
| `src/app` | **Perakitan**: bootstrap dan pengendali permainan yang menyatukan semuanya. |
| `public/cards` | Gambar kartu, lembar A4, README kartu, dan (setelah dibuat) `targets.mind`. |
| `scripts` | Perkakas Node: `build-card-sheet.mjs` (lembar A4) dan `build-targets.mjs` (pemeriksa target). |
| `tests` | Tes Node di balik lapisan domain, scene, AR, audio, dan UI. |
| `docs` | Desain dan rencana implementasi. |

```text
src/
  core/      logika domain murni (unit, tim, arena, pertarungan)
  scene/     rendering Three.js + efek pasir + model unit
    units/   model tiap unit
  ar/        pelacakan kartu MindAR
  audio/     efek suara
  ui/        layar & komponen
    screens/ layar kamera, pindai, battle, hasil
    components/
  app/       bootstrap & game controller
  styles/    CSS
```

---

## 12. Yang belum terverifikasi

Yang **sudah** terverifikasi lewat tes dan build: seluruh 243 tes lulus, `npm run build`
hijau, dan keenam kartu + lembar A4 dihasilkan.

Yang **belum** dan hanya bisa dibuktikan olehmu:

- Kualitas **cetak fisik** kartu (skala, ketebalan garis, ketajaman).
- **Pelacakan webcam sungguhan** di ruanganmu (pencahayaan, fokus, jarak).
- Bahwa `targets.mind` benar-benar dikompilasi dengan urutan yang benar - berkas itu
  **disediakan oleh pengguna** dan tidak ada di repositori.