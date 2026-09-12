# Pasukan Pasir dan Skala Struktur

Tanggal: 2026-09-10
Status: desain disetujui; spesifikasi menunggu tinjauan tertulis.

## Tujuan

Perbesar benteng dan bunker menjadi 1,5 kali ukuran robot sebagai struktur utama,
lalu tambahkan dua kelompok unit pasir yang dipanggil dari struktur tersebut:

- Benteng: lima kesatria berkuda pasir dan satu kapten.
- Bunker: empat minion gargoyle pasir.

Unit adalah model lengkap dengan detail visual, formasi, animasi keluar, siaga,
serangan demonstrasi ke arah depan arena, damage demonstrasi individual, serta
runtuh menjadi pasir sesuai damage. Belum ada target lawan nyata atau damage
antarstruktur pada tahap ini.

## Batasan

Pertahankan empat struktur, sistem grain instanced, kontrol orbit/zoom, AR root,
projectile tank/bunker, dan lifecycle struktur yang sudah ada. Optimasi AR/mobile,
AI tempur, navigasi medan, target lawan nyata, dan projectile pasukan berada di
luar scope. Unit bukan collider target struktur dan tidak ikut health struktur
induk secara langsung.

## Skala dan Layout

Robot menjadi acuan visual skala 1.0. Benteng dan bunker menerima skala model
1.5 melalui metadata ukuran yang konsisten dengan geometry, grain sampling,
collider, gerbang, pintu, dan titik spawn. Jangan hanya mengubah posisi kamera.
Tank tetap pada ukuran sekarang kecuali penyesuaian layout diperlukan.

Layout empat struktur disusun ulang agar footprint benteng/bunker yang membesar
tidak menutupi robot/tank dan memiliki ruang depan untuk unit. Posisi spawn dan
formasi berada di depan struktur dalam koordinat lokal induk, lalu diwariskan ke
root dunia. Root translation/scale/rotation tetap harus didukung.

## Pasukan Kesatria

Benteng memiliki `units` berisi enam unit individual: lima `KnightUnit` dan satu
`CaptainUnit`. Setiap unit mempunyai group, parts visual, health, state, seed,
formasi lokal, spawn delay, pose siaga, dan status grain transition.

Kesatria biasa terdiri dari kuda dengan kepala, leher, badan, empat kaki, dan
ekor; rider dengan torso armor, helm, bahu, pedang standar, dan opsi perisai.
Kuda dan rider memakai joint sehingga langkah, anggukan, dan tebasan terlihat
sebagai satu karakter. Lima unit memiliki variasi kecil pose, warna, ukuran, dan
delay, tetapi siluet tetap satu pasukan.

Kapten memakai kuda sedikit lebih besar, armor dada/helm/bahu lebih tebal,
crest/plume, pedang lebih panjang dan lebar, serta aksen jubah atau banner kecil.
Kapten berada di tengah atau sedikit di depan formasi dan memiliki animasi
aba-aba lalu tebasan besar dengan timing lebih lambat.

Formasi siaga default:

```text
  knight  captain  knight
     knight  knight  knight
```

## Pasukan Gargoyle

Bunker memiliki empat `GargoyleUnit` individual. Setiap unit memiliki badan,
kepala, tanduk/paruh atau taring, dua sayap, lengan/cakar, dan kaki/ekor.
Variasi ukuran, pose sayap, warna, dan seed membedakan unit tanpa membuat mesh
terlihat seperti salinan identik.

Saat empat unit hidup, formasi rapat dan bergerak sebagai kawanan melalui offset
bersama plus orbit kecil individual. Saat sebagian tumbang, unit tersisa menjaga
posisi yang tersedia tetapi radius orbit dan fase gerak berubah sehingga perilaku
terlihat individual. Tidak ada flocking physics atau pathfinding.

## Lifecycle Unit

State unit adalah `hidden`, `forming`, `exiting`, `guarding`, `attacking`,
`damaged`, `collapsing`, dan `fallen`.

### Kesatria

1. `hidden`: unit tidak terlihat di dalam/di belakang gerbang.
2. `forming`: grain membangun kuda dan rider pada titik spawn dengan urutan
   kaki/badan/armor, tanpa scale-pop mesh.
3. `exiting`: gerbang membuka; unit bergerak maju bergantian dengan stagger.
4. `guarding`: kuda mengangguk dan bergeser ringan; rider mengangkat pedang.
   Kapten memberi aba-aba dengan pedang lebih tinggi.
5. `attacking`: kesatria biasa menebas bergantian; kapten memakai tebasan besar
   dengan wind-up dan recovery lebih panjang. Serangan hanya menghadap depan.
6. `damaged`: damage memilih unit individual; armor/detail dapat hilang lebih
   dulu tanpa merusak unit lain.
7. `collapsing`: grain lepas dari volume unit, rider/kuda kehilangan soliditas,
   debris kecil jatuh, lalu unit menjadi pasir.
8. `fallen`: unit tidak menjadi collider atau target damage lagi.

### Gargoyle

1. Grain membentuk unit di pintu/permukaan bunker.
2. Unit melompat atau terbang pendek keluar dengan stagger berbeda.
3. Unit masuk formasi kawanan di depan bunker.
4. Serangan dilakukan dengan pola menukik satu per satu; dengan empat unit,
   pola terlihat serempak sebagai kawanan, sedangkan jumlah kecil terlihat lebih
   individual.
5. Damage memecah sayap/cakar/ornamen sebelum collapse penuh jika health belum
   habis.
6. Unit yang health-nya habis turun dan menjadi grain; unit hidup menyesuaikan
   formasi dan tetap dapat guarding/attacking.

Durasi awal tidak boleh memblokir interaksi terlalu lama: forming/exiting sekitar
2-4 detik, guarding loop, serangan demonstrasi sekitar 1-2 detik per aksi, dan
collapse maksimal sekitar 3 detik. Semua transisi dapat diinterupsi oleh damage
atau collapse sesuai aturan state.

## Damage Demonstrasi

Kontrol `Hantam pasukan` memilih unit hidup berdasarkan siklus atau titik klik,
lalu menerapkan damage hanya ke unit itu. Damage berikutnya memilih unit hidup
berikutnya atau unit terdekat. Nilai health unit berbeda:

- Knight biasa: health standar.
- Captain: health lebih tinggi dan armor mengurangi damage awal.
- Gargoyle: health sedang dengan armor/sayap sebagai detail yang bisa lepas.

Damage tidak menurunkan health struktur induk pada tahap ini. Unit yang runtuh
membersihkan grain slot dan mesh debris miliknya, mempertahankan slot unit lain,
dan tidak meninggalkan resource atau collider aktif.

## Interaksi

Benteng mendapat aksi `Bangun pasukan`, `Serang pasukan`, dan `Hantam pasukan`.
Bunker mendapat aksi `Panggil gargoyle`, `Serang kawanan`, dan `Hantam gargoyle`.
Runtuhkan pasukan membersihkan semua unit milik struktur tersebut; Bangun pasukan
atau Panggil gargoyle dapat membangun ulang unit yang fallen.

Klik pada struktur tetap menggunakan fokus/aksi yang ada. Klik pada mesh unit
memilih induk dan unit untuk fokus, tetapi tidak mengubah sistem pick collider
struktur. UI menampilkan jumlah unit hidup dan status kelompok tanpa membuat
layout kartu yang ada tidak dapat dipakai.

## Arsitektur

Tambahkan `sand-units.js` dengan `SandUnit`, `KnightUnit`, `CaptainUnit`, dan
`GargoyleUnit` atau factory yang memiliki interface sama:

- `build()` dan `collapse(damage)` untuk lifecycle.
- `update(dt, context)` untuk pose, movement, dan attack phase.
- `getMeshes()` untuk visual/picking non-struktural.
- `dispose()` untuk geometry, materials, dan grain owner.

`SandStructure` menyimpan `units`, `unitFormation`, dan `unitSpawner`. Benteng
memakai titik keluar gerbang; bunker memakai titik pintu/permukaan. `SandGrainSystem`
dipakai kembali oleh unit dengan owner unit, bukan owner struktur, sehingga
rebuild satu unit tidak menghapus grain unit lain. `main.js` meneruskan konfigurasi
dan kontrol, sementara generator struktur tetap bertanggung jawab pada bentuk
utama.

## Verifikasi

- Benteng dan bunker memiliki ukuran bounding box sekitar 1,5 kali robot pada
  sumbu yang sepadan dan tidak menutupi struktur lain.
- Startup membangun empat struktur tanpa unit terlihat sebelum dipanggil.
- Enam kesatria dan empat gargoyle membentuk model lengkap, keluar dari lokasi
  yang benar, dan berhenti pada formasi siaga.
- Kapten dapat dibedakan dari lima kesatria melalui armor, pedang, dan aksi.
- Gargoyle bergerak individual sekaligus tampak sebagai kawanan saat lengkap.
- Serangan demo tidak membutuhkan target dan tidak merusak struktur induk.
- Damage unit membuat hanya unit yang dipilih rusak/tumbang; unit lain tetap aktif.
- Rebuild unit menghapus grain lama, memulihkan health, dan tidak menggandakan
  mesh atau slot.
- Root transform, destroy struktur, dan disposal tidak meninggalkan unit/grain.
- Jalankan `node --test tests/sand-grains.test.js` serta `npm run build`.
- Smoke test browser memeriksa overview, fokus, semua aksi struktur, panggilan
  pasukan, serangan, damage, collapse, dan rebuild.

## Tinjauan Internal

Model pasukan dipisahkan dari struktur utama, damage demonstrasi tidak bercampur
dengan health struktur, dan grain ownership individual mencegah rebuild satu
unit menghapus unit lain. Satu sistem unit mencakup kesatria dan gargoyle melalui
state/update/dispose yang sama, sementara detail geometry dan perilaku kapten
tetap dapat berbeda.
