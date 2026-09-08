# PRODUCT REQUIREMENTS DOCUMENT

## AR Piano Tiles — “Play the Song in Space”

**Product Type:** Web-based Augmented Reality Rhythm Game / Interactive Musical Instrument  
**Platform:** Mobile Web  
**Primary Interaction:** Hand Tracking  
**AR Mode:** Markerless Surface-Based AR  
**Audio Engine:** Strudel  
**Core ML:** MediaPipe Hand Landmarker  
**Target Experience:** Single-player, spatial, musical, responsive  
**MVP Scope:** One-Hand + Two-Hand + custom chart + chord gameplay

---

# 1. Product Overview

### 1.1 Product Vision

**AR Piano Tiles — Play the Song in Space** adalah permainan musik berbasis Web AR yang mengubah permukaan nyata di sekitar pengguna menjadi sebuah **virtual musical instrument**.

Alih-alih pemain menyentuh layar untuk memainkan tile, pemain menggunakan tangannya di depan kamera. Sistem hand tracking membaca posisi dan gerakan jari, kemudian memetakannya ke sebuah **Invisible Musical Grid** di dalam ruang AR.

Tile virtual bergerak menuju **Hit Plane**. Ketika jari pemain melakukan gerakan crossing pada posisi dan waktu yang sesuai, tile dianggap dimainkan dan menghasilkan nada melalui Strudel.

Dengan demikian:

> **Pengguna tidak sekadar mengikuti musik. Pengguna memainkan dan membangun musik.**

---

# 2. Problem Statement

Game rhythm pada umumnya menggunakan layar datar sebagai media utama.

Piano Tiles membuat pemain mengikuti lane dengan menyentuh layar, tetapi interaksi tersebut tetap dua dimensi.

Web AR memiliki kesempatan untuk mengubah hubungan tersebut:

**screen → space**

Namun banyak proyek AR berhenti pada:

> “Objek 3D muncul ketika kamera diarahkan ke marker.”

Produk ini ingin menggunakan AR bukan hanya untuk visualisasi, melainkan sebagai **spatial interaction system**.

Masalah utama yang ingin diselesaikan:

1. Bagaimana membuat rhythm game yang benar-benar memanfaatkan ruang 3D?
2. Bagaimana membuat interaksi tangan cukup intuitif tanpa controller?
3. Bagaimana menjadikan musik sebagai output langsung dari aksi pemain?
4. Bagaimana memungkinkan lagu/chord baru dimasukkan tanpa mengubah game engine?
5. Bagaimana membuat pengalaman tersebut tetap feasible sebagai proyek Web?

---

# 3. Product Goals

## Primary Goals

### G1 — Spatial Rhythm Gameplay

Menciptakan pengalaman rhythm game di mana tile berada di ruang 3D dan tangan pemain menjadi input utama.

### G2 — Hand as Instrument

Tangan pemain diperlakukan sebagai alat musik virtual.

Gerakan jari menghasilkan event musik.

### G3 — Markerless AR

Game dapat ditempatkan pada permukaan nyata tanpa marker fisik.

WebXR hit testing dapat digunakan sebagai salah satu fondasi untuk menemukan permukaan nyata dan menempatkan konten AR, tetapi dukungan WebXR tetap bergantung pada browser/device sehingga fallback harus disiapkan.

### G4 — Generative / Interactive Audio

Event gameplay diterjemahkan menjadi note, chord, rhythm, dan effect melalui Strudel.

Strudel memiliki Pattern/Event scheduler serta JavaScript API untuk menyusun dan memodifikasi pattern secara programatik.

### G5 — Custom Song System

Game harus mampu menggunakan chart lagu yang berbeda tanpa mengubah kode gameplay.

Chart dapat mendeskripsikan:

- note
- chord
- timing
- lane
- hand
- duration
- difficulty
- note type

---

# 4. Non-Goals

Untuk versi MVP, produk **tidak** menargetkan:

- multiplayer
- online leaderboard
- full DAW/music editor
- realistic piano simulation
- automatic transcription semua lagu dari audio
- VR headset
- physical controller
- full-body tracking
- procedural 3D environment kompleks

Fitur-fitur tersebut dapat menjadi fase lanjutan.

---

# 5. Target User

## Primary User

Mahasiswa / pengguna muda yang:

- familiar dengan game rhythm
- memiliki smartphone modern
- tertarik mencoba pengalaman AR
- tidak harus memiliki kemampuan bermain piano
- menyukai musik dan eksperimen interaktif

## Secondary User

- pengguna yang ingin memainkan chord progression
- pengguna kreatif yang ingin membuat chart lagu sendiri
- pengunjung demo/exhibition
- dosen/penguji proyek yang mengevaluasi teknologi AR

---

# 6. Core User Experience

Pengalaman ideal:

```text
Open Website
      ↓
Camera Permission
      ↓
Scan Surface
      ↓
Place Music Portal
      ↓
Select Mode
      ↓
Select Song
      ↓
Calibration
      ↓
Countdown
      ↓
Tiles Start Falling
      ↓
Hand Moves
      ↓
Hit Detection
      ↓
Note / Chord
      ↓
Strudel Generates Sound
      ↓
Visual Feedback
      ↓
Song Progression
      ↓
Result
```

---

# 7. Core Concept

## “Invisible Musical Grid”

Sistem memiliki coordinate system 3D yang tidak terlihat oleh pengguna.

Grid tersebut menjadi fondasi gameplay.

Secara konseptual:

```text
                   Z
                   ↑
                   │
                   │
        L0   L1   L2   L3
         │    │    │    │
         │    │    │    │
         │    │    │    │
         ▼    ▼    ▼    ▼

──────────────────────────────────
             HIT PLANE
──────────────────────────────────

              PLAYER
```

Grid bukan sekadar collision system.

Grid adalah:

> **musical coordinate system.**

Setiap posisi lane memiliki hubungan dengan note atau pitch.

Contoh:

```text
Lane 0 → C
Lane 1 → E
Lane 2 → G
Lane 3 → B
```

Pada Two-Hand mode:

```text
Left:
L0 → C2
L1 → E2
L2 → G2
L3 → B2

Right:
R0 → C4
R1 → E4
R2 → G4
R3 → B4
```

Mapping dapat berubah berdasarkan lagu/key.

---

# 8. AR Architecture

## 8.1 Markerless Surface Detection

Game tidak menggunakan QR marker atau image target sebagai requirement utama.

Target deployment:

**surface-based AR**

Contoh:

- lantai
- meja
- permukaan datar

Permukaan ditemukan melalui AR hit testing, kemudian digunakan sebagai origin/anchor arena. WebXR Hit Test menyediakan mekanisme untuk mengambil hasil intersection terhadap lingkungan nyata dan memperoleh pose dari hasil tersebut.

## 8.2 AR Origin

Setelah surface dipilih:

```text
Surface detected
        ↓
User confirms
        ↓
AR Origin
        ↓
Musical Grid created
```

Origin menjadi pusat seluruh perhitungan:

```text
World Origin
     │
     ├── Musical Grid
     ├── Hit Plane
     ├── Lane
     ├── Tile
     └── VFX
```

## 8.3 Fallback

Karena WebXR tetap memiliki keterbatasan kompatibilitas antar-browser/device, MVP harus memiliki fallback non-immersive apabila AR session tidak tersedia. MDN saat ini masih menandai banyak bagian WebXR sebagai limited availability.

Fallback:

**Camera + pseudo-AR / screen-space mode**

Tetapi primary experience tetap AR.

---

# 9. Hand Tracking System

## 9.1 Model

Gunakan:

**MediaPipe Hand Landmarker**

Model menyediakan **21 hand landmarks**, termasuk fingertip dari tiap jari. Hasilnya mencakup landmark dalam normalized image coordinates serta world landmarks, dan task dapat dikonfigurasi untuk lebih dari satu tangan.

## 9.2 Relevant Landmarks

Gameplay terutama menggunakan:

```text
WRIST

THUMB_TIP
INDEX_FINGER_TIP
MIDDLE_FINGER_TIP
RING_FINGER_TIP
PINKY_TIP
```

21 landmark memungkinkan sistem melakukan analisis tambahan bila diperlukan.

## 9.3 One-Hand Mode

Primary input:

**Index Finger Tip**

Pipeline:

```text
Camera
 ↓
Hand Landmarker
 ↓
Index Tip
 ↓
World Projection
 ↓
Lane Determination
 ↓
Hit Plane Crossing
 ↓
Hit Event
```

## 9.4 Two-Hand Mode

Sistem menggunakan maksimal dua tangan.

Handedness digunakan untuk menentukan:

```text
LEFT HAND
RIGHT HAND
```

Kemudian setiap tangan memiliki set lane tersendiri.

```text
LEFT                         RIGHT

L0 L1 L2 L3                  R0 R1 R2 R3
│  │  │  │                   │  │  │  │
│  │  │  │                   │  │  │  │
```

MediaPipe Hand Landmarker menyediakan handedness bersama hand landmarks.

---

# 10. Hit Detection

## 10.1 Prinsip

Game tidak melakukan collision detection langsung antara mesh tangan dan mesh tile.

Sebaliknya:

> hand tracking → coordinate mapping → invisible hit volume

Konsep ini juga sejalan dengan praktik hit-testing game yang menggunakan simplified/invisible collision objects daripada menguji semua polygon mesh.

## 10.2 Hit Volume

Setiap lane mempunyai:

```text
X range
Y tolerance
Z hit range
```

Contoh:

```text
            TILE
             ↓
        ┌─────────┐
        │         │
        └─────────┘

────────────────────
     GOOD ZONE
────────────────────

════════════════════
    PERFECT LINE
════════════════════
```

## 10.3 Crossing Detection

Posisi tangan tidak cukup.

Sistem menyimpan:

```text
previous fingertip position
current fingertip position
velocity
```

Jika jari bergerak menuju hit plane dan melewati plane:

```text
previous Z < hitPlane
current Z >= hitPlane
```

maka sistem menghasilkan:

**Hit Candidate**

Kemudian candidate diverifikasi terhadap timing + lane.

## 10.4 Lane Detection

Misalnya:

```text
x = world hand position

if x ∈ Lane0:
    lane = 0

if x ∈ Lane1:
    lane = 1

if x ∈ Lane2:
    lane = 2

if x ∈ Lane3:
    lane = 3
```

## 10.5 Forgiveness

Hitbox dibuat lebih luas daripada visual tile.

Tujuannya mengompensasi noise hand tracking.

Contoh:

```text
Visual Tile:
20 cm

Interaction Zone:
28–35 cm
```

---

# 11. Timing System

Timing harus berbasis **musical clock**, bukan frame count.

Canonical unit:

**Beat**

Contoh:

```text
BPM = 120

1 beat = 0.5 second
```

Setiap chart event memiliki:

```text
beat
```

bukan hanya:

```text
millisecond
```

Contoh:

```json
{
  "beat": 8.5,
  "lane": 2,
  "note": "G4"
}
```

Game kemudian mengonversi beat → absolute playback time.

---

# 12. Judgement System

Minimal:

```text
PERFECT
GOOD
MISS
```

Contoh threshold:

```text
PERFECT
± 50 ms

GOOD
± 120 ms

MISS
> 120 ms
```

Threshold harus dapat dikonfigurasi berdasarkan difficulty.

Score akhir dapat mempertimbangkan:

```text
timing accuracy
+
spatial accuracy
+
combo
+
chord completeness
```

---

# 13. Note Types

## 13.1 Tap Note

Satu crossing.

```text
████
```

Fungsi:

- single note
- basic gameplay

---

## 13.2 Hold Note

Jari harus tetap berada dalam interaction zone selama durasi tertentu.

```text
████
████
████
████
```

Data:

```json
{
  "type": "hold",
  "startBeat": 10,
  "duration": 2
}
```

---

## 13.3 Chord Note

Beberapa note pada beat yang sama.

```text
██  ██  ██
```

Contoh:

```text
C4
E4
G4
```

→ C major.

---

## 13.4 Slide Note

Jari bergerak antar-lane.

```text
L0 → L1 → L2
```

Digunakan untuk:

- arpeggio
- melodic phrase
- special chart

---

# 14. Chord System

Chord adalah salah satu feature utama.

Chart tidak harus menyimpan chord sebagai tiga tile terpisah.

Format tingkat tinggi:

```json
{
  "beat": 16,
  "type": "chord",
  "chord": "Cmaj"
}
```

Engine melakukan expansion:

```text
Cmaj
 ↓
C E G
 ↓
lane mapping
 ↓
3 visual tiles
```

---

# 15. Chord Shapes

Untuk chord, game dapat memberikan visual grouping:

```text
     C      E      G
     │      │      │
     ▼      ▼      ▼

    ███    ███    ███
```

Pemain mendapatkan:

```text
3/3 → PERFECT CHORD
2/3 → GOOD
1/3 → PARTIAL
0/3 → MISS
```

Optional rule:

Chord dimainkan hanya ketika semua required notes diterima dalam window yang sama.

---

# 16. One-Hand Mode Design

## Layout

```text
┌──────────────────────────┐
│                          │
│     INCOMING NOTES       │
│                          │
│        ↓   ↓             │
│                          │
│      ↓        ↓          │
│                          │
│──────────────────────────│
│     L0 L1 L2 L3          │
└──────────────────────────┘
```

## Default

4 lanes.

Primary finger:

**index finger**

Advanced gameplay:

optional multi-finger chord support.

## Intent

One-Hand Mode ditujukan untuk:

- casual
- beginner
- melody
- simple chord
- short play session

---

# 17. Two-Hand Mode Design

## Layout

```text
LEFT HAND                 RIGHT HAND

L0 L1 L2 L3                R0 R1 R2 R3
│  │  │  │                 │  │  │  │
│  │  │  │                 │  │  │  │
```

Total:

**8 lanes**

Suggested musical structure:

```text
LEFT
bass / lower chord notes

RIGHT
melody / upper chord notes
```

Two-Hand mode menjadi mode advanced.

---

# 18. Song System

## 18.1 Song vs Chart

Song dan chart harus dipisahkan.

### Song

Menjelaskan musik:

```text
title
artist
bpm
key
timeSignature
musical events
```

### Chart

Menjelaskan gameplay:

```text
difficulty
lane
hand
noteType
timing
```

Satu song dapat memiliki beberapa chart:

```text
Song
 ├── Easy Chart
 ├── Normal Chart
 ├── Hard Chart
 └── Expert Chart
```

---

# 19. Example Song Schema

```json
{
  "id": "song_001",
  "title": "Demo Song",
  "artist": "Original",
  "bpm": 100,
  "key": "C",
  "timeSignature": "4/4",

  "events": [
    {
      "beat": 0,
      "type": "chord",
      "chord": "C"
    },
    {
      "beat": 4,
      "type": "chord",
      "chord": "G"
    },
    {
      "beat": 8,
      "type": "chord",
      "chord": "Am"
    },
    {
      "beat": 12,
      "type": "chord",
      "chord": "F"
    }
  ]
}
```

---

# 20. Example Gameplay Chart

```json
{
  "difficulty": "normal",

  "notes": [
    {
      "beat": 0,
      "lane": 0,
      "hand": "left",
      "type": "tap",
      "note": "C3"
    },

    {
      "beat": 1,
      "lane": 1,
      "hand": "right",
      "type": "tap",
      "note": "E4"
    },

    {
      "beat": 2,
      "hand": "right",
      "type": "chord",
      "notes": [
        {
          "lane": 1,
          "note": "E4"
        },
        {
          "lane": 3,
          "note": "G4"
        }
      ]
    }
  ]
}
```

---

# 21. MIDI Import

Future/high-value feature:

```text
MIDI
 ↓
Parser
 ↓
MIDI Note Events
 ↓
Timing normalization
 ↓
Simultaneous-note grouping
 ↓
Chord detection
 ↓
Lane assignment
 ↓
Chart generation
```

Contoh:

```text
MIDI:
60
64
67

       ↓

C major

       ↓

Chord Tile
```

MIDI import lebih cocok daripada mencoba otomatis mentranskripsi seluruh lagu dari audio untuk MVP.

---

# 22. Custom Song Editor

User dapat membuat lagu sendiri melalui editor.

Fields:

```text
Song Title
BPM
Key
Time Signature
```

Kemudian:

```text
+ Add Note
+ Add Chord
+ Add Hold
+ Add Slide
```

Timeline:

```text
0     1     2     3     4
|-----|-----|-----|-----|
 C           Am
```

Editor mengeluarkan:

```json
song.json
chart.json
```

---

# 23. Strudel Integration

Strudel berfungsi sebagai **musical rendering engine**, bukan sekadar background music.

Strudel bekerja dengan Pattern/Event system dan menyediakan JavaScript functions maupun Mini-Notation untuk menyusun pola musik.

## Event Flow

```text
Gameplay Event
      ↓
Note Event
      ↓
Musical Event
      ↓
Strudel Pattern / Trigger
      ↓
Audio Output
```

Contoh konseptual:

```text
HIT C4
 ↓
Strudel note(C4)

HIT E4
 ↓
Strudel note(E4)

HIT G4
 ↓
Strudel note(G4)
```

Chord:

```text
C4 + E4 + G4
        ↓
polyphonic event
```

---

# 24. Music Layer System

Strudel digunakan untuk menghasilkan beberapa layer:

```text
Layer 1 — Rhythm
Layer 2 — Bass
Layer 3 — Chord
Layer 4 — Melody
Layer 5 — FX
```

Gameplay dapat membuka/menutup layer.

Contoh:

```text
Combo 0
→ Rhythm

Combo 10
→ Bass

Combo 20
→ Chord

Combo 40
→ Melody

Combo 60
→ FX
```

Dengan demikian player merasa:

> semakin bagus bermain → musik semakin lengkap.

---

# 25. Dynamic Audio

Gameplay memengaruhi audio.

Input:

```text
note hit
chord hit
combo
miss
velocity
accuracy
```

Output:

```text
pitch
volume
filter
reverb
density
effect
```

Contoh:

```text
Perfect
→ clean note

Good
→ normal note

Miss
→ muted / degraded note
```

---

# 26. Visual Feedback

Setiap hit harus mempunyai respon instan.

## Perfect

```text
Tile explodes
+
Particle
+
Light pulse
+
Musical accent
```

## Good

```text
Small particle
+
soft pulse
```

## Miss

```text
Tile disappears
+
subtle distortion
+
audio error
```

---

# 27. World Reaction

AR environment ikut berubah berdasarkan performa pemain.

Contoh:

```text
Combo 0
→ neutral world

Combo 10
→ subtle glow

Combo 20
→ particles

Combo 40
→ environment pulse

Combo 60
→ full musical visualization
```

Tujuannya:

> player bukan hanya memainkan score, tetapi “menghidupkan ruang”.

---

# 28. Portal / Arena Design

Ketika surface ditemukan:

```text
surface
   ↓
portal
   ↓
musical arena
```

Arena berbentuk:

- holographic
- glass
- neon
- minimal
- low-poly

Visual tile menggunakan cuboid 3D.

Tile memiliki:

```text
front face
top face
side face
emissive material
shadow
particle trail
```

Tidak perlu photorealistic.

---

# 29. Camera & UX

Pengguna memegang smartphone.

Initial flow:

```text
[Start AR]

Scan floor/table

        ↓

[Place Arena]

        ↓

Choose:
ONE HAND
TWO HANDS

        ↓

[Calibrate]

        ↓

READY
```

---

# 30. Calibration

Calibration penting karena posisi kamera setiap pengguna berbeda.

Game menampilkan:

> “Place your hand inside the starting zone.”

Kemudian:

```text
Detect hand
↓
Estimate comfortable interaction area
↓
Adjust lane width
↓
Adjust hit plane depth
```

Target:

setiap pemain mendapatkan arena yang nyaman tanpa mengharuskan ukuran tangan tertentu.

---

# 31. Accessibility / Comfort

Karena hand tracking bisa noisy, game harus menghindari tuntutan presisi absolut.

Requirement:

- tile hitbox lebih besar dari visual
- timing tolerance configurable
- speed dapat diubah
- lane width adjustable
- one-hand mode tersedia
- no mandatory rapid movement
- optional reduced visual effects

---

# 32. Difficulty System

## Easy

- 4 lane
- slow
- melody
- no slide
- simple chords

## Normal

- 4 lane
- medium speed
- melody + basic chord

## Hard

- 8 lane
- two-hand
- faster sequence
- holds
- chord

## Expert

- 8 lane
- dense notes
- chord transitions
- slide
- complex rhythms

---

# 33. Scoring

Score:

```text
base note score
× accuracy multiplier
× combo multiplier
```

Example:

```text
Perfect = 100
Good = 70
Miss = 0
```

Combo:

```text
10 combo → x1.2
25 combo → x1.5
50 combo → x2
```

Final score:

```text
Score
Accuracy
Max Combo
Perfect
Good
Miss
Chord Accuracy
```

---

# 34. Song End

Setelah lagu selesai:

```text
SONG COMPLETE

Score: 93,420

Accuracy: 94.7%

Perfect: 184
Good: 32
Miss: 11

Max Combo: 78

Chord Accuracy: 91%

RANK
A
```

Optional:

> **“You built 94% of the song.”**

Ini memperkuat konsep bahwa pengguna memainkan musik.

---

# 35. MVP

MVP harus dapat melakukan hal berikut:

### AR

- camera permission
- surface detection
- place arena
- create world origin

### Hand

- detect one hand
- detect two hands
- identify index fingertip
- detect left/right hand

### Game

- 4 lanes One-Hand
- 8 lanes Two-Hand
- tile spawning
- tile movement
- invisible hit plane
- lane detection
- timing judgement

### Music

- single-note playback
- chord playback
- Strudel integration
- dynamic event trigger

### Song

- local JSON chart
- BPM
- notes
- chords
- difficulty

### Visual

- tile animation
- hit VFX
- miss VFX
- combo feedback
- result screen

---

# 36. Phase 2

Setelah MVP stabil:

- hold notes
- slide notes
- custom chart editor
- MIDI import
- dynamic music layers
- world reaction
- advanced chord system
- multiple songs
- local song library

---

# 37. Phase 3

Future:

- user-generated songs
- song sharing
- online leaderboard
- multiplayer
- full hand/finger piano mode
- advanced gesture system
- adaptive difficulty
- AI chart generation
- automatic accompaniment

---

# 38. Technical Architecture

Recommended conceptual stack:

```text
                 Browser
                    │
          ┌─────────┴─────────┐
          │                   │
       Camera              WebXR
          │                   │
          ▼                   ▼
   MediaPipe Hand       Surface / Hit Test
     Landmarker               │
          │                   │
          └──────────┬────────┘
                     ▼
                AR Runtime
                     │
                     ▼
              Musical Grid
                     │
             ┌───────┴───────┐
             ▼               ▼
       Hand Input        Chart Engine
             │               │
             └───────┬───────┘
                     ▼
                Hit System
                     │
             ┌───────┴────────┐
             ▼                ▼
          Gameplay         Audio Event
             │                │
             │              Strudel
             │                │
             └───────┬────────┘
                     ▼
                  Output
```

---

# 39. Data Architecture

Core entities:

```text
Song
Chart
NoteEvent
ChordEvent
PlayerState
HandState
ARWorld
MusicalGrid
AudioEvent
```

### HandState

```text
handedness
landmarks
indexTip
velocity
confidence
```

### NoteEvent

```text
id
beat
lane
hand
pitch
type
duration
```

### ChordEvent

```text
id
beat
chordName
notes[]
duration
```

---

# 40. Performance Requirements

Target:

**30 FPS minimum**, ideal 60 FPS pada device yang mampu.

Hand tracking dan rendering tidak boleh menyebabkan input terasa tertunda.

Priority:

```text
Input latency
>
hit detection
>
visual effects
```

VFX harus diturunkan kualitasnya apabila frame rate turun.

---

# 41. Latency Budget

Karena ini rhythm game, latency adalah bagian penting.

Target:

```text
Hand tracking
↓
Position processing
↓
Hit detection
↓
Audio trigger
```

harus terasa near-real-time.

Audio scheduling sebaiknya tidak bergantung pada rendering frame.

Musical clock menjadi source of truth.

---

# 42. Browser / Device Constraints

WebXR harus dianggap **capability-based**, bukan universal.

WebXR dan hit-test masih memiliki status compatibility terbatas pada browser tertentu menurut dokumentasi MDN per September 2026.

Maka MVP harus memiliki:

```text
SUPPORTED
PARTIAL
FALLBACK
```

Device test matrix minimal:

- Android Chrome
- iPhone/iOS Safari
- desktop browser untuk non-AR testing

---

# 43. Security / Privacy

Camera digunakan untuk:

- AR
- hand tracking

Tidak ada kebutuhan menyimpan video kamera.

Requirement:

> Camera frames diproses secara lokal sebanyak mungkin.

Tidak ada upload frame kamera ke server pada MVP.

User harus memberikan explicit camera permission.

---

# 44. Asset Direction

Semua asset visual utama dibuat sendiri.

## Style

Rekomendasi:

**stylized futuristic musical hologram**

Bukan:

- realistic piano
- generic neon cube
- stock 3D asset

## Asset List

### Environment

- portal
- floor/grid visual
- hit plane indicator
- background particles

### Gameplay

- normal tile
- hold tile
- chord tile
- slide tile

### Feedback

- particle burst
- combo burst
- perfect effect
- miss effect

---

# 45. Audio Direction

Audio dibagi menjadi:

### Musical

- piano
- synth
- bass
- percussion
- pad

### Feedback

- hit
- perfect
- miss
- combo

### Ambient

- portal
- world activation
- song completion

Strudel bertanggung jawab terutama pada layer musical dan procedural behavior. Strudel mendukung kombinasi pattern JavaScript/Mini-Notation dan event scheduling yang sesuai untuk pendekatan tersebut.

---

# 46. Core Product Loop

Product loop final:

```text
PLACE ARENA
      ↓
CHOOSE SONG
      ↓
CALIBRATE
      ↓
SEE TILE
      ↓
MOVE HAND
      ↓
HIT
      ↓
MAKE SOUND
      ↓
BUILD MUSIC
      ↓
GET COMBO
      ↓
WORLD REACTS
      ↓
FINISH SONG
      ↓
IMPROVE SCORE
      ↓
PLAY AGAIN
```

---

# 47. Success Metrics

MVP berhasil bila:

### Technical

- surface berhasil dideteksi
- arena dapat ditempatkan
- satu tangan dapat dimainkan
- dua tangan dapat dimainkan
- hit event terdeteksi secara konsisten
- note/chord terdengar
- chart selesai dimainkan tanpa desync

### UX

Target pengujian:

> pengguna baru dapat memahami cara bermain dalam < 60 detik tanpa tutorial verbal.

### Gameplay

Target awal:

> pemain merasa bahwa gerakan tangannya benar-benar “memainkan” musik.

---

# 48. Acceptance Criteria

## AR-01

**Given** kamera aktif  
**When** pengguna mengarahkan kamera ke permukaan datar  
**Then** sistem menyediakan placement target.

## AR-02

**Given** surface telah dipilih  
**When** pengguna melakukan placement  
**Then** arena terpasang pada koordinat yang stabil.

## HAND-01

**Given** satu tangan terlihat  
**When** index fingertip bergerak  
**Then** sistem memperbarui koordinat jari secara real-time.

## HAND-02

**Given** dua tangan terlihat  
**When** keduanya terdeteksi  
**Then** sistem membedakan left/right hand.

MediaPipe menyediakan handedness serta world/image landmarks sebagai bagian dari Hand Landmarker result.

## HIT-01

**Given** tile berada di hit zone  
**When** fingertip melewati hit plane pada lane tile  
**Then** tile menghasilkan hit event.

## HIT-02

**Given** timing berada pada perfect window  
**When** lane benar  
**Then** judgement = PERFECT.

## MUSIC-01

**Given** valid hit event  
**When** hit diproses  
**Then** corresponding musical event dikirim ke audio engine.

## CHORD-01

**Given** chord membutuhkan tiga notes  
**When** ketiga notes diterima dalam timing window  
**Then** chord dianggap complete.

## SONG-01

**Given** valid chart JSON  
**When** song dimulai  
**Then** chart dapat dimainkan tanpa hardcoding lagu ke gameplay engine.

---

# 49. Demo Scenario

Durasi ideal presentasi:

**2–3 menit**

### 0:00

User membuka website.

### 0:10

Camera mencari lantai.

### 0:20

Portal piano muncul.

### 0:30

User memilih:

**ONE HAND**

### 0:40

Tile muncul.

### 0:45

User memukul beberapa tile menggunakan telunjuk.

Setiap hit menghasilkan note.

### 1:00

Combo meningkat.

Visual arena mulai bereaksi.

### 1:15

User mengganti ke:

**TWO HANDS**

### 1:30

8 lane muncul.

Left hand memainkan lower notes.

Right hand memainkan melody/chords.

### 1:50

Chord muncul.

User memainkan beberapa finger secara bersamaan.

### 2:05

Lagu menjadi lengkap.

### 2:20

Result:

> **You Built the Song — 94%**

Ini menjadi punchline demo.

---

# 50. Unique Selling Proposition

Produk bukan:

> “Piano Tiles tetapi di AR.”

Produk adalah:

> **“A spatial musical game where your hands become the instrument and your performance generates the music.”**

Tiga pembeda utama:

### 1. Spatial

Music game terjadi di ruang nyata.

### 2. Hand-driven

Tangan menjadi controller.

### 3. Generative

Gameplay tidak hanya menentukan score; gameplay menghasilkan musik.

---

# 51. Risk Register

## R1 — Hand Tracking Tidak Stabil

**Risk:** jari hilang / jitter.

**Mitigation:**

- smoothing
- velocity filter
- larger hitbox
- calibration
- confidence threshold

## R2 — WebXR Compatibility

**Risk:** device tidak mendukung AR.

**Mitigation:**

- fallback mode
- capability detection
- tested-device list

## R3 — Audio Latency

**Risk:** visual tepat tetapi audio terlambat.

**Mitigation:**

- separate musical clock
- scheduled audio
- audio pre-initialization

## R4 — Two-Hand Tracking Failure

**Risk:** satu tangan kehilangan tracking.

**Mitigation:**

- graceful degradation
- pause if required
- visual hand status

## R5 — Too Much Scope

**Risk:** custom editor + MIDI + AR + hand tracking + Strudel menjadi terlalu besar.

**Mitigation:**

MVP hanya:

```text
AR
+
1/2 hand
+
tap
+
chord
+
JSON chart
+
Strudel
```

---

# 52. Recommended Development Order

## Milestone 1 — Hand Tracking

```text
Camera
→ MediaPipe
→ fingertip visualization
```

Goal:

tangan stabil.

---

## Milestone 2 — Invisible Grid

```text
fingertip
→ world projection
→ lane
```

Goal:

tahu tangan berada di lane mana.

---

## Milestone 3 — Hit Plane

```text
hand movement
→ crossing detection
→ hit
```

Goal:

gerakan tangan terasa seperti memukul.

---

## Milestone 4 — AR Arena

```text
surface
→ placement
→ grid
→ tiles
```

Goal:

game benar-benar berada di ruang nyata.

---

## Milestone 5 — Musical Engine

```text
hit
→ note
→ Strudel
```

Goal:

gerakan menghasilkan suara.

---

## Milestone 6 — Chord

```text
multiple simultaneous hits
→ chord
```

Goal:

pemain dapat memainkan harmoni.

---

## Milestone 7 — Two-Hand

```text
left
+
right
→ 8 lane
```

Goal:

advanced gameplay.

---

## Milestone 8 — Song System

```text
JSON
→ chart
→ playable song
```

Goal:

song engine reusable.

---

## Milestone 9 — Polish

```text
VFX
UI
sound design
animation
result
```

Goal:

presentable final product.

---

# 53. MVP Definition of Done

MVP dianggap selesai jika seorang pengguna dapat:

1. Membuka website melalui smartphone.
2. Memberikan camera permission.
3. Menempatkan AR arena pada permukaan.
4. Memilih One-Hand.
5. Memainkan minimal satu lagu menggunakan hand tracking.
6. Mendapatkan note berdasarkan gerakan jari.
7. Memainkan minimal satu chord.
8. Melihat score/combo.
9. Memainkan Two-Hand mode.
10. Menyelesaikan satu lagu.
11. Memainkan chart lagu lain tanpa mengubah source code gameplay.

---

# 54. Final Product Statement

**AR Piano Tiles — Play the Song in Space** adalah sebuah Web AR rhythm game yang menggabungkan:

**Markerless AR**

+

**Hand Tracking**

+

**Invisible 3D Musical Grid**

+

**Spatial Rhythm Gameplay**

+

**Chord-Based Piano Interaction**

+

**Strudel Generative Audio**

Tujuan akhirnya bukan membuat pengguna berpikir:

> “Saya sedang memainkan game.”

Tetapi:

> **“Saya sedang memainkan musik di ruang saya sendiri.”**

Itulah identitas utama produk.