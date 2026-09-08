# AR Piano Tiles — MIDI to Tile Preview & Player

Program visualisasi dan konversi file musik **MIDI menjadi Falling Piano Tiles** interaktif dengan dukungan Web Audio Synthesizer, ekspor data chart (JSON), serta mode Auto-Play dan Interactive Play.

---

## 🚀 Cara Menjalankan Program

### Cara 1: Menggunakan Python (Direkomendasikan)
Jalankan perintah berikut di terminal:
```bash
python app.py
```
*Script akan menjalankan server lokal ringan dan **otomatis membuka browser** ke halaman aplikasi.*

### Cara 2: Langsung Membuka File HTML
Buka file `index.html` langsung dengan browser apa saja (Google Chrome, Microsoft Edge, Firefox).
*(Catatan: Anda dapat langsung drag & drop file MIDI atau memilih file lewat tombol Open MIDI).*

### Cara 3: Konversi File MIDI ke JSON via Terminal (CLI)
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

## 📁 Struktur File Proyek

```
d:/codebase/testing-app/piano-midi/
├── index.html       # Antarmuka web visualizer & synthesizer utama
├── app.py           # Launcher Python (HTTP Server & CLI Converter)
├── demo.mid         # File MIDI sampel melodi & akor
├── demo_tiles.json  # Contoh hasil ekspor data tile dalam format JSON
└── README.md        # Panduan penggunaan
```
