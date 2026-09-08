# AR Piano Tiles — Play the Song in Space 🥽🎹

**AR Piano Tiles — Play the Song in Space** adalah permainan ritme dan instrumen musik spasial berbasis **Web AR** interaktif. Proyek ini mengubah permukaan nyata (meja atau lantai) di sekitar pemain menjadi **Holographic Musical Arena 3D** di mana tangan pemain menjadi alat musik virtual melalui teknologi **MediaPipe Hand Tracking** dan audio sintetis studio **Strudel Concert Grand Piano**.

Aplikasi ini juga menyediakan **2D Desktop Preview Player & MIDI Converter** klasik untuk kemudahan pratinjau, pengeditan, serta konversi chart ritme.

---

## 🚀 Cara Menjalankan Program

### Cara 1: Web AR Mode (3D Spatial Play in Space) — Direkomendasikan
Jalankan server lokal dengan argumen `--ar`:
```bash
python app.py --ar
```
*Browser akan otomatis membuka `http://127.0.0.1:8000/ar.html`.*

### Cara 2: 2D Player Mode (Desktop Preview & Synthesizer)
Jalankan server tanpa argumen:
```bash
python app.py
```
*Browser akan otomatis membuka `http://127.0.0.1:8000/index.html`.*  
Anda dapat beralih ke AR Mode kapan saja dengan menekan tombol **`🥽 AR Mode (Play in Space)`** di header.

### Cara 3: Membuka Langsung via Browser
Buka file `ar.html` (untuk Web AR 3D) atau `index.html` (untuk 2D player) langsung dengan browser Google Chrome, Microsoft Edge, atau Safari.

### Cara 4: Konversi File MIDI ke JSON via Terminal (CLI)
Jika Anda hanya ingin mengekstrak data tile ke format JSON untuk game engine (seperti Unity, Godot, WebXR):
```bash
# Konversi ke 8 lanes (default)
python app.py convert demo.mid -o tiles.json

# Konversi ke 4 lanes
python app.py convert demo.mid -o tiles_4lanes.json --lanes 4
```

---

## 🎮 Fitur Unggulan

1. **Load File MIDI Fleksibel**:
   - Klik tombol **`📂 Open MIDI`** untuk memilih file `.mid` atau `.midi` dari komputer.
   - Atau langsung **Drag & Drop** file MIDI ke layar.
   - Tombol **`🎵 Demo`** langsung memuat lagu sampel (*Canon in D*) tanpa perlu mencari file MIDI terlebih dahulu.

2. **Web Audio Polyphonic Synthesizer**:
   - Dilengkapi synthesizer piano bawaan browser.
   - Setiap tile yang menyentuh garis putih langsung berbunyi dengan nada piano yang jernih dan bebas delay.
   - Pengatur volume (🔊) dan tombol mute.

3. **Pilihan Jumlah Lanes (Jalur)**:
   - Mendukung **4 lanes**, **6 lanes**, **8 lanes**, dan **12 lanes**.
   - Algoritma pemetaan nada (*pitch-to-lane*) otomatis menyesuaikan rentang nada terendah hingga tertinggi.

4. **Dua Mode Permainan**:
   - **Auto-Play**: Visualizer otomatis di mana tile jatuh dan bunyi piano tersinkronisasi secara otomatis.
   - **Interactive (Play Mode)**: Uji ketangkasan bermain piano tiles dengan keyboard atau mouse/touch. Dilengkapi sistem penilaian (*PERFECT*, *GREAT*, *MISS*), skor, dan combo.

5. **Keyword Kombo & Multi-Lane Chord Slam (4-8 Lanes)**:
   - **Spacebar / Enter**: Menekan Spacebar atau Enter langsung memukul seluruh tile chord simultan (4 sampai 8 lanes) tanpa kendala keyboard ghosting.
   - **Tombol `⚡ SLAM CHORD [Space]`**: Tombol di HUD layar yang dapat diklik kapan saja.
   - **Hit Line Tap**: Menyentuh garis hit pada kanvas memicu Chord Slam.
   - **Multi-key Press Buffer**: Menekan beberapa tombol tuts bersamaan secara manual (rentang 110ms) menghasilkan bonus chord combo dan efek visual megachord.

6. **Sistem Mute Jalur Audio MIDI (Latihan Tuts Terpisah)**:
   - **Pemisahan Jalur Auto vs Ketikan**: Mute jalur tertentu agar pemutaran otomatis MIDI tidak bersuara pada jalur tersebut, namun tuts ketikan Anda tetap bersuara piano nyata.
   - **Tombol Mute Per-Jalur**: Tombol `🔊` / `🔇` di atas masing-masing badge tuts.
   - **Preset Dropdown (Auto MIDI)**: `Auto All`, `Mute Right/Melody`, `Mute Left/Bass`, `Mute All (Tuts Only)`.
   - **Indikator Visual**: Teks penanda `🔇 TUTS ONLY` di bagian atas kanvas untuk jalur yang di-mute.

7. **Kontrol Keyboard**:
   - **Play / Pause**: Tekan `Spasi` (di mode Auto) atau tombol Play/Pause di header (`Esc` juga didukung).
   - **Chord Slam (Multi-Lane)**: Tekan `Spasi` atau `Enter` di mode Interactive.
   - **4 Lanes**: Tuts `D`, `F`, `J`, `K`.
   - **6 Lanes**: Tuts `S`, `D`, `F`, `J`, `K`, `L`.
   - **8 Lanes**: Tombol angka `1` - `8` atau deretan home row `A`, `S`, `D`, `F`, `J`, `K`, `L`, `;`.
   - Klik / sentuh langsung pada jalur lane juga didukung.

8. **Interactive Timeline Scrubber**:
   - Klik di bagian timeline atas untuk melompat (*seek*) ke detik manapun dalam lagu.

9. **Export Tile Chart (JSON)**:
   - Klik tombol **`📥 Export JSON`** untuk mengunduh struktur data tile yang sudah terhitung rapi (posisi lane, waktu mulai, durasi, nilai MIDI, nama not, velocity).

---

## ✨ Fitur Utama Web AR Mode (`ar.html`)

### 1. Markerless Surface-Based AR
- **WebXR Hit-Testing**: Menggunakan deteksi permukaan WebXR standar untuk mendeteksi meja atau lantai secara otomatis tanpa memerlukan marker fisik (QR code / image tracking).
- **One-Tap Placement Reticle**: Reticle holografik melacak bidang datar; satu ketukan langsung mengunci posisi arena musik di ruang nyata Anda.
- **Camera Fallback**: Untuk desktop atau perangkat yang belum mendukung WebXR (misal Safari iOS atau browser desktop), game otomatis mengaktifkan umpan kamera video dan menempatkan arena pada bidang datar virtual secara mulus.
- **Mouse / Touch Interaction Fallback**: Mendukung pengujian langsung di browser desktop melalui klik mouse atau sentuhan layar.

### 2. MediaPipe Hand Tracking (Vision System)
- **Zero-Controller Spatial Input**: Membaca gestur dan posisi jari di depan kamera menggunakan MediaPipe Hand Landmarker (`@mediapipe/tasks-vision`).
- **1-Hand Mode (4 Lanes)**: Melacak ujung jari telunjuk (Index Tip) untuk memainkan melodi solo dengan gesit dan akurat.
- **2-Hand Mode (8 Lanes)**: Melacak kedua tangan sekaligus secara simultan:
  * **Tangan Kiri**: Memainkan 4 lane bass/iringan (Lane 0 - 3).
  * **Tangan Kanan**: Memainkan 4 lane melodi/akor (Lane 4 - 7).
- **EMA Smoothing (Exponential Moving Average)**: Filter matematis real-time yang meredam jitter dan noise kamera sehingga gerakan fingertip tetap stabil dan responsif.

### 3. Invisible 3D Musical Grid & Hit Crossing Detection
- **3D Hit Plane**: Tile cuboid virtual jatuh di sepanjang sumbu Z menuju garis hit laser holografik di depan pemain.
- **Crossing Detection**: Deteksi pukulan dihitung saat ujung jari melintasi bidang hit plane dari ruang depan ke belakang (`Z crossing`).
- **Forgiveness Hitbox**: Toleransi batas tepi lane sebesar 20% untuk memastikan kenyamanan bermain tanpa mengorbankan presisi ritme.
- **Strict Rhythm Windows**:
  * **PERFECT**: Selisih waktu hit $\le \pm 50\text{ ms}$ (Skor: 100 poin + bonus combo).
  * **GOOD**: Selisih waktu hit $\le \pm 120\text{ ms}$ (Skor: 70 poin + bonus combo).
  * **MISS**: Tile terlewat lebih dari $+120\text{ ms}$ (Combo reset ke 0).

### 4. Strudel Concert Grand Piano Sound Engine
- **Studio Grand Soundbank**: Menggunakan sampel piano konser resolusi tinggi (Strudel Dough-samples) yang dipetakan ke seluruh 88 tuts piano standar.
- **Low-Latency Web Audio Context**: Penjadwalan nada dengan latensi mendekati nol dan polifoni dinamis.
- **Audio Feedback**: Efek suara terintegrasi untuk judgement *Perfect*, *Good*, dan *Miss*.
- **Synthesizer Fallback**: Audio synthesizer polyphonic bawaan siap sedia jika koneksi jaringan offline.

### 5. Hand Reach Calibration & Real-Time HUD
- **Panduan Kalibrasi Jangkauan**: Membimbing pemain memosisikan tangan di dalam frame kamera sebelum lagu dimulai, otomatis mengukur lebar jangkauan tangan dan kedalaman hit plane yang nyaman.
- **HUD Spasial Dinamis**: Menampilkan skor real-time, progress bar lagu, akurasi %, combo counter dengan efek pulsasi, dan judgement floating badges.
- **Combo Multipliers (Tier 1-4)**:
  * 10 combo: 1.25×
  * 20 combo: 1.5×
  * 40 combo: 2.0×
  * 60+ combo: 2.5×
- **World Reaction & VFX System**: Pancaran aura arena 3D bereaksi dan berpendar sesuai level combo streak; ledakan partikel warna-warni menyala pada setiap pukulan sempurna.
- **Result Performance Screen**: Menampilkan evaluasi skor akhir, akurasi %, max combo, persentase akor, dan punchline penutup:
  > *"You built XX% of the song in space!"*

### 6. Custom Song & Chart System
- Menyediakan lagu sampel siap main: *Canon in D* (Johann Pachelbel) dan *Twinkle Twinkle Little Star*.
- Tombol **`📂 Import JSON / MIDI File`** untuk langsung mengunggah dan memainkan lagu atau chart kustom buatan sendiri tanpa perlu mengubah kode sumber game.

---

## 🧪 Menjalankan Automated Tests

Seluruh modul inti (parsing lagu, hit detection 3D, hand tracking EMA smoothing, Three.js arena layout, VFX particle engine, skor, dan sound engine) dilindungi oleh unit test berbasis Node.js native test runner:

```bash
node --test tests/*.test.mjs
```

Semua 57 test suite wajib lolos (100% pass) sebelum rilis.

---

## 📁 Struktur File Proyek

```
d:/codebase/testing-app/piano-midi/
├── index.html                                 # 2D visualizer & player dengan badge peluncur AR Mode
├── ar.html                                    # 3D Web AR viewport (Three.js + MediaPipe + Strudel)
├── app.py                                     # Server HTTP lokal (dukungan --ar & MIME types) & konverter CLI
├── demo.mid                                   # File sampel MIDI
├── demo_tiles.json                            # Contoh ekspor tile chart format JSON
├── PRD — AR Piano Tiles_ Play the Song in Space.md  # Dokumen spesifikasi produk komprehensif
├── README.md                                  # Dokumentasi lengkap panduan aplikasi
│
├── data/
│   └── songs/
│       ├── demo_canon.json                    # Chart bawaan Canon in D (4-lane & 8-lane)
│       └── demo_twinkle.json                  # Chart bawaan Twinkle Little Star (4-lane & 8-lane)
│
├── src/
│   ├── ar/
│   │   ├── arScene.js                         # Three.js 3D arena, tile meshes, & reticle placement
│   │   └── vfxSystem.js                       # Particle engine, combo aura, & world reaction pulse
│   ├── audio/
│   │   └── soundEngine.js                     # Strudel concert grand piano & feedback SFX
│   ├── engine/
│   │   ├── hitDetector.js                     # 3D musical grid, Z crossing detection, & scoring
│   │   └── songParser.js                      # Parser chart lagu, konversi MIDI/JSON, & ekspansi akor
│   ├── ui/
│   │   └── arUI.js                            # State machine, calibration manager, scoring, & HUD
│   └── vision/
│       └── handTracker.js                     # MediaPipe Hand Landmarker, EMA smoothing, & 2-hand mode
│
└── tests/
    ├── arScene.test.mjs                       # Unit test untuk 3D arena & layout
    ├── arUI.test.mjs                          # Unit test untuk state machine & score manager
    ├── handTracker.test.mjs                   # Unit test untuk vision smoothing & landmark normalization
    ├── hitDetector.test.mjs                   # Unit test untuk Z crossing & rhythm window
    ├── songParser.test.mjs                    # Unit test untuk chart parsing & chord expansion
    ├── soundEngine.test.mjs                   # Unit test untuk pitch mapping & volume control
    └── vfxSystem.test.mjs                     # Unit test untuk particle engine & visual tiers
```

---

## 📜 Lisensi & Atribusi

- **Audio Engine**: Didukung oleh [Strudel](https://strudel.cc) dan Dough-samples grand piano soundbank.
- **Vision Engine**: Didukung oleh [Google MediaPipe](https://developers.google.com/mediapipe) Hand Landmarker.
- **3D Engine**: Didukung oleh [Three.js](https://threejs.org).
