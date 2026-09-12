# Kartu Cetak Perang Pasir

Folder ini berisi gambar kartu yang menjadi jangkar AR (image tracking) dan satu lembar
A4 siap potong. Enam kartu tersebut adalah:

| Kartu | Peran | Berkas |
| --- | --- | --- |
| Benteng Pasir | base | `benteng.svg` |
| Bunker Berduri | base | `bunker.svg` |
| Robot Pasir | artileri | `robot.svg` |
| Tank Pasir | artileri | `tank.svg` |
| Kesatria Pasir | prajurit | `kesatria.svg` |
| Gargoyle Pasir | prajurit | `gargoyle.svg` |

Lembar siap cetak: **`lembar-a4.svg`** (A4 potrait, tiga kolom dua baris).
Berkas target hasil kompilasi: **`targets.mind`** (belum ada di repositori, lihat bagian
terakhir).

> **Lembar A4 dibuat otomatis.** `lembar-a4.svg` **dihasilkan** oleh
> `scripts/build-card-sheet.mjs` dari keenam berkas kartu di atas - isi setiap kartu
> disalin (inline) apa adanya ke lembar tersebut. **Setelah mengubah salah satu kartu,
> jalankan ulang skrip itu** supaya lembar tidak melenceng dari kartu aslinya:
>
> ```bash
> node scripts/build-card-sheet.mjs
> ```
>
> Jangan menyunting `lembar-a4.svg` secara manual: perubahan akan hilang pada
> pembuatan ulang berikutnya dan lembar bisa tidak sinkron dengan kartu.

---

## 1. Cara mencetak lembar A4

1. Buka `lembar-a4.svg` di browser (Chrome/Firefox), atau buka langsung dari aplikasi
   pengolah gambar/vektor.
2. Pada dialog cetak, atur:
   - **Ukuran kertas: A4** (210 x 297 mm), orientasi **potrait**.
   - **Skala: 100%** - jangan pilih "Fit to page", "Shrink to fit", atau "Scale to
     printable area". Penskalaran akan mengubah ukuran kartu dan melemahkan pelacakan.
   - Margin: 0 atau minimum; pastikan tidak ada bagian kartu yang terpotong.
3. Kertas **matte atau biasa** sudah cukup. Kertas glossy/reflektif justru memantulkan
   cahaya dan menyulitkan pelacakan.
4. Setelah dicetak, **ukur satu kartu dengan penggaris**. Tinggi kartu harus sekitar
   **90 mm** dan lebarnya sekitar **63,5 mm**. Bila tidak, cetak ulang dengan skala 100%.
5. Potong mengikuti **garis putus-putus** dan **tanda sudut** di sekeliling setiap kartu.
   Usahakan potongan rapi agar tepi kertas tidak menutupi motif kartu.

## 2. Ukuran kartu yang disarankan

- Ukuran hasil desain: **63,53 x 90 mm** per kartu (perbandingan 600:850).
- Kartu berukuran sekitar **9 cm tinggi** ini nyaman dipegang dan dipotong, namun tetap
  cukup besar untuk kamera webcam mengenali motifnya.
- **Ukuran harus konsisten.** Berkas target `targets.mind` dikompilasi dari gambar sumber
  dengan ukuran tertentu. Bila hasil cetak berbeda skala dari gambar sumber, pose 3D akan
  meleset dan model bisa terlihat "melayang" atau bergetar. Jadi: cetak semua kartu dari
  lembar yang sama, pada skala 100%, jangan campur hasil cetak berbeda skala.

## 3. Pencahayaan

Pelacakan gambar bergantung pada kontras. Atur pencahayaan seperti berikut:

- Gunakan **cahaya rata dan menyebar** (diffuse). Cahaya ruangan dari beberapa arah lebih
  baik daripada satu lampu sorot.
- **Hindari kilau (glare)** dan pantulan langsung dari lampu atau jendela ke permukaan kertas.
- **Hindari bayangan keras**, terutama bayangan tangan, kepala, atau badan kamera yang
  jatuh tepat di atas kartu.
- **Jangan gunakan meja gelap atau reflektif.** Meja putih/abu-abu matte memberi kontras
  terbaik antara kartu terang dan latar belakang.
- Cahaya matahari langsung yang berubah-ubah juga kurang ideal; cahaya ruangan yang stabil
  lebih disarankan.

## 4. Bingkai webcam

- **Keenam kartu harus terlihat sekaligus** dalam satu bingkai. Jangan sampai ada kartu yang
  keluar dari tepi gambar atau tertutup tangan.
- Posisi kamera boleh **kira-kira dari atas (overhead)** atau **dari sudut yang dangkal**
  (menyerong dari depan meja). Keduanya berfungsi selama seluruh kartu masih terlihat.
- Jaga jarak agar setiap kartu memenuhi porsi bingkai yang cukup besar - kartu yang terlalu
  kecil di gambar sulit dilacak.
- Kartu boleh disusun dengan urutan bebas: tiga kartu di kiri garis tengah dan tiga kartu di
  kanan, dengan tepat **satu base, satu artileri, dan satu prajurit di setiap sisi**.
- Hindari gerakan kamera yang cepat dan goyangan saat battle berlangsung - kartu harus diam.

## 5. Mengompilasi berkas target dengan MindAR

MindAR **tidak menyediakan compiler resmi untuk Node.js**, sehingga `targets.mind` harus
dibuat sekali secara manual memakai Image Target Compiler milik MindAR di browser.

1. Buka **https://hiukim.github.io/mind-ar-js-doc/tools/compile** di Chrome.
   Alat ini berjalan sepenuhnya di browser; tidak ada gambar yang diunggah ke server.
2. Seret **keenam** berkas SVG di bawah ini ke area unggah, **dalam urutan ini** (urutan
   menentukan indeks target, dan indeks itu dipetakan ke tipe unit oleh `src/ar/card-targets.js`):
   1. `benteng.svg`
   2. `bunker.svg`
   3. `robot.svg`
   4. `tank.svg`
   5. `kesatria.svg`
   6. `gargoyle.svg`
3. Tunggu sampai semua gambar selesai diproses, lalu klik **Download**.
4. Simpan hasil unduhan dengan nama **`targets.mind`** dan letakkan di folder ini:

   ```text
   public/cards/targets.mind
   ```

5. Verifikasi dari terminal:

   ```bash
   node scripts/build-targets.mjs
   ```

   Skrip ini **tidak mengompilasi apa pun** (tidak ada compiler Node resmi). Tugasnya:
   memastikan enam gambar sumber ada, memberi instruksi di atas, dan memeriksa berkas
   target. Bila `targets.mind` belum ada, skrip keluar dengan **kode non-nol** disertai
   instruksi; bila sudah ada, skrip mengonfirmasi dan keluar dengan kode **0**.

### 5.1 Aturan penting: satu sesi, satu bundel

Bagian ini mencegah kesalahan yang paling sering terjadi saat mengompilasi.

- **Masukkan KEENAM berkas SVG kartu satu per satu ke dalam SATU sesi kompilasi** -
  `benteng.svg`, `bunker.svg`, `robot.svg`, `tank.svg`, `kesatria.svg`, `gargoyle.svg`,
  dalam urutan itu. Alat ini mengompilasi seluruh daftar gambar sekaligus menjadi satu
  bundel. Jangan mengompilasi kartu satu per satu di sesi terpisah.
- **JANGAN mengompilasi `lembar-a4.svg` untuk aplikasi.** Lembar A4 memuat keenam kartu
  dalam satu halaman, jadi alat hanya mengenalinya sebagai **satu** gambar/target. Bundel
  hasilnya tidak bisa dipakai aplikasi, yang membutuhkan enam target terpisah. Lembar A4
  hanya untuk **dicetak**, bukan untuk sumber kompilasi.
- **Alat ini menghasilkan SATU bundel yang berisi keenam target.** Menekan tombol
  **Download beberapa kali hanya menghasilkan salinan yang identik**, karena isi bundel
  tidak berubah. Cukup **satu** berkas - jangan simpan enam salinan dengan nama berbeda
  (misalnya `BENTENG.mind`, `BUNKER.mind`, dan seterusnya), karena semuanya sama dan hanya
  membingungkan.
- **Simpan bundel hasil unduhan dengan nama `public/cards/targets.mind`.** Nama itulah yang
  dibaca aplikasi (lihat `src/ar/card-targets.js`, konstanta `TARGET_FILE`). Bundel bernama
  lain tidak akan pernah termuat.

Cara cepat membedakan keduanya dari **ukuran berkas**:

| Berkas | Isi | Ukuran (di proyek ini) |
| --- | --- | --- |
| `targets.mind` (benar) | 6 target (enam kartu) | kira-kira **3 MB** |
| `lembar-a4.mind` (tidak dipakai aplikasi) | 1 target (seluruh lembar A4) | kira-kira **0,7 MB** |

Bundel enam target jauh lebih besar karena berisi data enam gambar. **Angka di atas hanya
pengamatan pada proyek ini, bukan patokan pasti** - ukuran sebenarnya bergantung pada
kompleksitas dan resolusi gambar yang dikompilasi. Jadi, bila hasil unduhan hanya sekitar
0,7 MB, kemungkinan besar Anda mengompilasi `lembar-a4.svg`, bukan keenam kartu.

Untuk keperluan penyimpanan, bundel A4 yang salah **tidak perlu dihapus**: berkas itu
disimpan sebagai **`lembar-a4.mind`** di folder ini agar jelas asalnya dan tidak tertukar
dengan `targets.mind`.

## 6. Catatan tentang penskalaan printer

Bila printer mencetak lembar ini dengan skala selain 100% (misalnya "fit to page"),
ukuran kartu akan berubah dari ukuran gambar sumber. Akibatnya:

- Pose model 3D bisa bergeser atau tampak tidak menempel pada kartu.
- Pelacakan bisa gagal sama sekali.

Bila itu terjadi, **cetak ulang lembar pada skala 100%** dan, bila perlu, kompilasi ulang
`targets.mind` dari hasil pindaian kartu yang sudah dicetak. Cetak ulang biasanya cukup;
kompilasi ulang hanya diperlukan bila ukuran kartu benar-benar tidak bisa dikembalikan ke
ukuran aslinya.

## 7. Membuat ulang lembar A4

Lembar A4 adalah berkas turunan, bukan berkas sumber. Alurnya:

```text
public/cards/<kartu>.svg  --(scripts/build-card-sheet.mjs)-->  public/cards/lembar-a4.svg
```

- **Sumber:** enam berkas kartu (`benteng.svg` ... `gargoyle.svg`).
- **Perkakas:** `scripts/build-card-sheet.mjs`.
- **Keluaran:** `public/cards/lembar-a4.svg`.

Skrip membaca ulang keenam kartu setiap kali dijalankan, lalu menyusunnya kembali menjadi
A4 potrait **3 kolom x 2 baris**:

| Baris | Kolom 1 | Kolom 2 | Kolom 3 |
| --- | --- | --- | --- |
| 1 | benteng (base) | bunker (base) | robot (artileri) |
| 2 | tank (artileri) | kesatria (prajurit) | gargoyle (prajurit) |

Setiap kartu digambar pada ukuran tetap **63,52941 x 90 mm** (skala seragam 0,10588 dari
gambar 600 x 850 px) dan dilengkapi tanda potong. **Jalankan skrip ini setelah mengubah
salah satu kartu**, lalu cetak ulang lembar. Ingat: mengubah gambar kartu juga berarti
`targets.mind` perlu dikompilasi ulang (bagian 5).
