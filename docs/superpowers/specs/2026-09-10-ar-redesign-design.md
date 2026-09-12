# Redesign AR Sand War: UI/UX dan Struktur Proyek

Tanggal: 2026-09-10
Status: desain disetujui melalui sesi visual; spesifikasi menunggu tinjauan pengguna.

## Tujuan

Merapikan proyek `spongebob-sand-war` menjadi aplikasi web AR yang terstruktur,
dengan satu alur permainan yang jelas dan UI yang tidak menutupi kamera.

Dua sasaran yang tidak dapat dipisahkan:

1. **Struktur**: memecah `main.js` yang sekarang memegang scene, battle, DOM,
   mode AR, audio, dan lifecycle menjadi modul berbatas jelas dengan dependensi
   satu arah.
2. **UI/UX**: mengganti tumpukan panel yang muncul bersamaan dengan wizard
   bertahap dan HUD minimal yang menyisakan arena sebagai fokus.

Keluaran akhir dibungkus sebagai bundle Vite vanilla JavaScript.

## Konteks Saat Ini

- `main.js` (76 baris padat) membuat renderer, scene, arena, controller AR,
  battle system, audio, seluruh DOM gameplay, selection, dan animation loop.
- `index.html` menumpuk `mode-panel`, `setup-panel`, `hud`, `battle-controls`,
  dan `unit-tabs`. `#hud` memiliki atribut `hidden`, tetapi `.panel`/`#hud`
  memakai `display` dari CSS sehingga fase tidak benar-benar terpisah.
- `style.css` hanya 10 baris dengan deklarasi panjang satu baris per aturan;
  token warna, radius, dan bayangan bercampur dengan layout.
- `battle-system.js` sudah menjadi domain murni yang teruji (roster, targeting,
  cooldown, damage, reinforcement, victory, event log).
- `sand-structures.js` memuat material, efek, lifecycle, generator empat
  struktur, proyektil, dan memanggil `SandUnitSpawner` untuk benteng/bunker.
- `sand-units.js` menghasilkan pasukan bawaan: lima kesatria + satu kapten dari
  benteng, empat gargoyle dari bunker, lengkap dengan state, formasi, dan
  animasi. Teruji di `tests/sand-units.test.js` dan `tests/sand-weapons.test.js`.
- `ar-placement.js` sudah menangani WebXR hit-test, reticle, dan anchor.
- `marker-ar-controller.js` baru berupa skeleton izin kamera, belum menjadi
  adapter image tracking penuh.
- `audio-system.js` sudah memisahkan musik per fase dan SFX per event, tetapi
  belum memiliki UX kontrol.
- Folder proyek tidak memiliki metadata Git.

## Keputusan yang Disetujui

| Topik | Keputusan |
| --- | --- |
| Struktur folder | Layered domain folders |
| Model unit | Satu roster unit terpadu |
| Navigasi | Wizard bertahap |
| HUD battle | Minimal |
| Kontrol AR | Gesture dengan menu sekilas |
| Build | Bundle Vite vanilla JavaScript |
| Prioritas platform | Setara mobile dan desktop |
| Arah visual | Tactical Beach Tabletop |

## Struktur Proyek

Dependensi hanya boleh mengarah ke dalam; tidak ada modul yang mengimpor modul
lapisan yang lebih tinggi.

```text
src/
├── app/
│   ├── bootstrap.js
│   └── game-controller.js
├── core/
│   ├── battle-system.js
│   ├── roster.js
│   ├── unit-definitions.js
│   └── rng.js
├── scene/
│   ├── scene-system.js
│   ├── sand-structures.js
│   ├── sand-grains.js
│   ├── sand-effects.js
│   └── units/
│       ├── base-unit.js
│       ├── knight-unit.js
│       ├── gargoyle-unit.js
│       └── unit-factory.js
├── ar/
│   ├── capabilities.js
│   ├── ar-markerless.js
│   └── ar-marker.js
├── audio/
│   └── audio-system.js
├── ui/
│   ├── app-state.js
│   ├── screens/
│   │   ├── screen-mode.js
│   │   ├── screen-placement.js
│   │   ├── screen-roster.js
│   │   ├── screen-build.js
│   │   ├── screen-battle.js
│   │   └── screen-result.js
│   └── components/
│       ├── status-pill.js
│       ├── quick-menu.js
│       ├── unit-label.js
│       ├── summon-zone.js
│       └── toast.js
└── styles/
    ├── tokens.css
    └── app.css
```

Aturan dependensi:

- `core/` tidak mengimpor Three.js, DOM, atau modul lain di `src/`.
- `scene/` hanya mengimpor `core/` dan Three.js.
- `ar/`, `audio/`, dan `ui/` mengimpor `core/` dan `scene/` bila perlu, dan
  tidak saling mengimpor secara melingkar.
- `app/` boleh mengimpor semuanya dan menjadi satu-satunya tempat yang menyusun
  dependency.
- `index.html` hanya memuat `<script type="module" src="/src/app/bootstrap.js">`.

## Model Unit Terpadu

Enam tipe unit memiliki satu definisi stat di `core/unit-definitions.js` dan
satu jalur damage.

| Tipe | Peran | Health | Damage | Cooldown |
| --- | --- | --- | --- | --- |
| castle | base | 200 | — | — |
| bunker | base | 200 | — | — |
| robot | war-machine | 120 | 16 | 1,6 dtk |
| tank | war-machine | 100 | 20 | 2,0 dtk |
| knight | reinforcement | 70 | 14 | 1,3 dtk |
| gargoyle | reinforcement | 60 | 12 | 1,1 dtk |

- Roster awal wajib tepat satu base dan satu war-machine per tim.
- Reinforcement dipanggil pemain, maksimal dua aktif per tim (satu knight dan
  satu gargoyle), dengan cooldown 8 detik setelah hancur atau digantikan.
- War machine memprioritaskan war machine musuh, lalu reinforcement musuh, lalu
  base musuh.
- Battle selesai saat salah satu base mencapai nol health.
- Keputusan AI, cooldown, damage, dan pemenang deterministik untuk formasi dan
  urutan waktu summon yang sama.

Pasukan bawaan (lima kesatria + kapten, empat gargoyle) tidak lagi muncul
otomatis. Model kuda dan gargoyle yang sudah ada dipakai ulang sebagai aset
visual `knight` dan `gargoyle` melalui `scene/units/unit-factory.js`. `knight`
tetap melee (menebas), `gargoyle` tetap menukik lalu mencakar.

## Fase Permainan

State machine eksplisit di `ui/app-state.js`:

```text
mode → placement → roster → build → battle → result
```

- Satu fase aktif dalam satu waktu. Hanya layar fase aktif yang dirender.
- Progress bar tipis di bagian atas menunjukkan posisi fase.
- Arena dirender sejak fase placement; fase berikutnya tidak membuat scene baru.
- Transisi tidak dapat ditumpuk; aksi yang tidak valid pada fase berjalan
  diabaikan, bukan mengubah state.
- Kembali dari `roster` ke `placement` harus membuang instance struktur dan
  grain lama tanpa menyentuh resource milik fase lain.

## Layar

### mode

Memilih Markerless Table AR, Marker Card AR, atau Preview Desktop. Menampilkan
hasil deteksi kemampuan perangkat dari `ar/capabilities.js`, termasuk alasan
bila mode tidak tersedia.

### placement

Hanya relevan untuk Markerless Table AR. Menampilkan reticle, instruksi singkat,
dan tombol "Letakkan Arena". Untuk Marker Card AR, layar ini menampilkan progres
kartu yang terdeteksi. Untuk Preview Desktop, layar ini dilewati.

### roster

Empat slot: base dan war-machine untuk tiap tim. Validasi memakai `core/roster.js`
dan menampilkan satu pesan kesalahan yang spesifik. Audio diatur di layar ini.

### build

Menampilkan progres pembentukan pasir. Model muncul setelah grain selesai,
bukan sebagai scale pop.

### battle

Menggunakan HUD minimal yang dijelaskan di bagian berikut.

### result

Pemenang, ringkasan singkat, lalu Ulangi / Ganti Roster.

## HUD Minimal

- Kamera tidak pernah tertutup panel, bar, atau feed.
- Satu pill status ringkas, misalnya `01:24 · Biru 168 / Merah 162`.
  Dapat diketuk untuk membuka detail sekilas yang menutup sendiri.
- Tidak ada tab unit, summon bar, atau event feed permanen.

Interaksi dunia 3D:

- Ketuk unit menampilkan label kecil yang menempel pada model: health, target,
  dan status. Ketuk lagi untuk menutup.
- Ketuk zona pasir kosong di sisi tim memanggil `knight` atau `gargoyle`.
  Saat cooldown, cincin pasir pada zona terisi sebagai indikator.
- Target aktif digambarkan sebagai garis tipis 3D dari penyerang ke targetnya.
- Cubit dan geser untuk orbit serta zoom diorama.

Kontrol aplikasi:

- Ketuk ganda pada area kosong membuka menu sekilas: Ulang, Ganti Roster, Audio.
  Menu menutup otomatis dan tidak pernah menutupi unit yang dipilih.
- Tombol Ulangi dan Ganti Roster hanya aktif setelah battle selesai.
- Onboarding satu kalimat menjelaskan gesture ini saat pertama memasuki battle.

## Aturan AR

- Markerless Table AR memerlukan secure context, izin kamera, `navigator.xr`,
  dukungan `immersive-ar`, dan `hit-test`.
- Marker Card AR memerlukan secure context, izin kamera, dan dukungan image
  tracking untuk enam kartu.
- Keduanya tidak pernah berjalan bersamaan. Transisi mode menunggu pelepasan
  penuh video track dan resource kamera sebelum controller lain dimulai.
- Kegagalan dilaporkan secara spesifik, dan pengguna tetap dapat lanjut ke
  Preview Desktop tanpa kehilangan konfigurasi roster.
- `ar/capabilities.js` menjadi satu-satunya tempat yang menjawab pertanyaan
  dukungan perangkat.

## Audio

- Musik fase melalui Strudel: tenang saat setup, tegang saat battle, ringkas
  saat result.
- SFX per event battle: summon, attack, impact, destroy, victory, error.
- Mute dan volume musik/SFX terpisah, disimpan di fase roster.
- Audio hanya dimulai setelah interaksi pengguna. Kegagalan audio tidak fatal.

## Struktur Berkas dan Gaya

- `styles/tokens.css` memuat warna, radius, jarak, bayangan, dan tipografi.
- `styles/app.css` memuat layout serta gaya komponen dan tidak mendefinisikan
  nilai warna atau radius baru di luar token.
- Komponen UI di `ui/components/` membuat elemen DOM sendiri dan menerima data
  melalui parameter, tanpa mengimpor `scene/` atau `core/` untuk membaca state
  global.
- Tidak ada `display` yang menimpa atribut `hidden`; visibilitas diatur dengan
  satu mekanisme saja.

## Penanganan Kesalahan

- Izin kamera ditolak, mode AR tidak didukung, kartu tidak terdeteksi,
  tracking hilang, formasi tidak valid, summon masih cooldown, audio diblokir,
  dan sesi AR berakhir di tengah battle semuanya menjadi state yang dapat
  dipulihkan dengan pesan singkat.
- Sesi AR berakhir di tengah battle menghentikan pembaruan battle, membersihkan
  resource AR, dan menampilkan pilihan lanjut atau kembali.
- Panggilan berulang pada aksi yang sama tidak boleh menghasilkan struktur,
  proyektil, model, atau instance audio ganda.

## Pengujian

- `core/` diuji sebagai domain murni dengan Node test runner: validasi roster,
  prioritas target, cooldown, aturan reinforcement, kondisi menang, dan
  determinisme berdasarkan formasi serta event log.
- `scene/units/` diuji sebagai model library: setiap tipe menghasilkan parts
  dengan health, state, dan lifecycle yang benar, tanpa bergantung pada DOM.
- State machine fase di `ui/app-state.js` diuji untuk transisi valid dan
  penolakan transisi tidak valid.
- `npm test` menjalankan seluruh tes, `npm run build` memverifikasi bundle.
- Pemeriksaan manual di mobile dan desktop: alur wizard lengkap, tidak ada panel
  bertumpuk, kamera AR tetap bersih, dan dua mode AR tidak pernah aktif
  bersamaan.

## Di Luar Lingkup

- Multiplayer jaringan, akun, papan skor daring, dan server otoritatif.
- Pelacakan kartu secara live bersamaan dengan WebXR immersive.
- Paritas iOS.
- Optimasi frame-rate khusus perangkat dan simulasi fisika butir pasir.
- Penambahan fitur permainan baru di luar roster enam unit yang sudah ada.