Saya ingin kamu mengimprovisasi sistem hit detection pada project berikut:

Repository:
https://github.com/RidhoHam/tiles-game-AR

Sebelum melakukan perubahan, pelajari terlebih dahulu seluruh flow yang relevan, terutama:

- `ar.html`
- `src/vision/handTracker.js`
- `src/engine/hitDetector.js`
- `src/ar/arScene.js`
- `src/ar/vfxSystem.js`
- parser/chart/song timing yang terkait

Jangan langsung menulis ulang seluruh architecture.

Pertahankan sistem MIDI/chart, rendering tiles, song clock, scoring, audio, dan MediaPipe yang sudah berjalan. Fokus perubahan hanya pada mekanisme interaksi tangan terhadap piano/lane.

## Masalah yang ingin diselesaikan

Implementasi sekarang mencoba merepresentasikan tangan pemain dalam coordinate space arena 3D dan mendeteksi crossing terhadap `hitPlaneZ`.

Secara teori pendekatan ini benar, tetapi dalam penggunaan kamera biasa maupun fallback AR terdapat masalah UX:

Tangan asli pemain yang terlihat dari kamera tidak selalu tampak secara natural berada tepat di atas objek piano 3D.

Akibatnya terdapat ketidaksesuaian antara:

1. posisi tangan asli yang dilihat pemain,
2. posisi fingertip hasil MediaPipe,
3. posisi piano/tile virtual,
4. hit plane 3D,
5. dan timing note.

Saya ingin mengganti atau menambahkan mekanisme interaksi yang lebih toleran dan lebih sesuai secara visual.

## Konsep baru

Implementasikan:

# Screen-Space Dynamic Piano Hitbox System

Jangan melakukan computer vision tambahan untuk mendeteksi ulang tile atau piano dari pixel layar.

Engine sudah mengetahui:

- jumlah lane,
- posisi lane,
- posisi piano,
- posisi falling tiles,
- note target time,
- hit line,
- Three.js camera,
- dan transform arena.

Gunakan data internal tersebut sebagai source of truth.

MediaPipe digunakan hanya untuk menentukan posisi jari pemain pada camera/screen space.

Kemudian sistem menentukan apakah fingertip pemain sedang berada di atas hitbox lane piano yang sesuai.

---

## 1. Screen-space coordinate system

`HandTracker` saat ini sudah memiliki normalized camera coordinates seperti:

```js
hand.cameraIndexTip.x
hand.cameraIndexTip.y
```

dengan range kira-kira:

```txt
x = 0..1
y = 0..1
```

Gunakan coordinate tersebut sebagai basis utama interaction.

Konversikan bila diperlukan menjadi pixel:

```js
screenX = cameraIndexTip.x * viewportWidth
screenY = cameraIndexTip.y * viewportHeight
```

Pastikan mirror orientation kamera konsisten dengan visual video.

Jangan membuat transform coordinate kedua yang bertentangan dengan mekanisme mirror yang sudah ada di `handTracker.js`.

---

## 2. Dynamic hitbox per piano lane

Untuk setiap lane piano yang tampil, buat sebuah logical hitbox.

Contoh untuk 8 lanes:

```txt
Lane 0 -> Hitbox 0
Lane 1 -> Hitbox 1
Lane 2 -> Hitbox 2
...
Lane 7 -> Hitbox 7
```

Hitbox bukan collision box fisik Three.js yang wajib terlihat.

Hitbox adalah logical rectangle/polygon dalam screen space.

Secara konseptual:

```js
{
    lane: 3,

    minX,
    maxX,

    minY,
    maxY,

    centerX,
    centerY
}
```

Hitbox harus berada di area key piano / bagian bawah hit line yang secara visual dianggap pemain sebagai lokasi menekan note.

Hitbox tidak mengikuti falling tile.

Hitbox mengikuti lane/key piano.

Tile hanya menentukan apakah lane tersebut saat ini mempunyai note yang boleh dipukul.

---

## 3. Jangan hardcode posisi layar

Jangan melakukan seperti:

```js
laneWidth = window.innerWidth / laneCount
```

jika posisi actual piano di Three.js tidak benar-benar memenuhi seluruh layar.

Sebaliknya, gunakan geometry dari arena.

Idealnya:

```txt
3D piano lane position
        ↓
Three.js camera projection
        ↓
normalized device coordinates
        ↓
screen coordinates
        ↓
2D lane hitbox
```

Buat helper seperti:

```js
projectWorldToScreen(worldPosition, camera, viewport)
```

atau abstraction serupa.

Untuk setiap lane, ambil posisi kiri/kanan serta bagian depan/belakang area piano/hit zone kemudian project ke screen.

Dari hasil projection tersebut bentuk screen-space hitbox.

Dengan demikian jika:

- kamera bergerak,
- arena berubah ukuran,
- device portrait/landscape berubah,
- 4 lane menjadi 8 lane,
- arena calibration berubah,

hitbox tetap mengikuti piano secara otomatis.

---

## 4. Source of truth untuk lane

`ARScene.layout.laneCenters` dan ukuran lane yang sudah tersedia harus menjadi source of truth.

Jangan membuat sistem lane baru yang terpisah dari `ARScene`.

Jika diperlukan tambahkan API seperti:

```js
arScene.getLaneScreenBounds(laneIndex)
```

atau:

```js
arScene.getScreenHitboxes()
```

Tetapi implementasikan dengan coupling seminimal mungkin.

---

## 5. Finger selection

Gunakan MediaPipe fingertip landmarks.

Minimal:

```txt
INDEX_FINGER_TIP
```

Tetapi desain sistem agar nantinya mudah diperluas ke:

```txt
THUMB_TIP
INDEX_FINGER_TIP
MIDDLE_FINGER_TIP
RING_FINGER_TIP
PINKY_TIP
```

Jangan mengubah seluruh gameplay menjadi multi-finger sekarang jika belum dibutuhkan.

Untuk MVP:

```txt
1 hand mode:
index fingertip

2 hand mode:
left index fingertip
right index fingertip
```

---

## 6. Hit harus membutuhkan dua kondisi

Jangan menghasilkan hit hanya karena fingertip berada di sebuah lane.

Hit hanya valid jika dua kondisi terjadi secara bersamaan.

### Spatial condition

Fingertip berada di hitbox lane:

```js
fingerInsideLaneHitbox === true
```

### Temporal condition

Pada lane tersebut terdapat active note yang sedang berada dalam timing window:

```js
abs(currentSongTime - note.timeSec) <= hitWindow
```

Contoh:

```txt
PERFECT = ±50 ms
GOOD = ±120 ms
MISS = setelah window terlewati
```

Gunakan timing configuration existing dari `HitDetector` jika memungkinkan.

---

## 7. Jangan gunakan overlap statis sebagai trigger

Jika jari hanya diletakkan diam di lane, jangan membuat setiap note berikutnya otomatis terkena hit.

Kita membutuhkan gesture/edge trigger.

Implementasikan salah satu atau kombinasi berikut:

### Preferred approach: downward press detection

Simpan previous fingertip screen position.

```js
prevY
currentY
velocityY
```

Sebuah press dianggap terjadi jika fingertip bergerak ke arah bawah layar dengan velocity minimum tertentu.

Contoh conceptual:

```js
const downwardVelocity = currentY - previousY;

const pressing =
    downwardVelocity > PRESS_VELOCITY_THRESHOLD;
```

Karena MediaPipe screen Y meningkat ke bawah.

Trigger hit hanya pada transition:

```txt
NOT_PRESSED
     ↓
PRESSING
```

bukan selama status PRESSING terus berlangsung.

---

## 8. Finger hit state machine

Implementasikan state per hand/finger.

Contoh:

```txt
IDLE
↓
HOVER
↓
PRESSING
↓
TRIGGERED
↓
RELEASE
↓
IDLE
```

Tujuannya untuk menghindari repeated hits.

Contoh object:

```js
fingerState = {
    hand: "Right",
    lane: 4,

    previousX: 0,
    previousY: 0,

    velocityX: 0,
    velocityY: 0,

    isInsideHitbox: false,

    pressed: false,
    lastHitTime: 0
}
```

Tambahkan short debounce/cooldown jika dibutuhkan, misalnya:

```txt
60–100 ms
```

Tetapi jangan membuat cooldown terlalu panjang sehingga rapid notes menjadi tidak playable.

---

## 9. Candidate note selection

Ketika press event terjadi pada lane:

```js
press(lane, currentSongTime)
```

cari active note terdekat pada lane tersebut.

Pseudo-code:

```js
const candidates = activeNotes.filter(note =>
    !note.played &&
    noteContainsLane(note, lane) &&
    Math.abs(currentSongTime - note.timeSec) <= goodWindow
);

const candidate = candidates.sort(
    (a, b) =>
        Math.abs(currentSongTime - a.timeSec) -
        Math.abs(currentSongTime - b.timeSec)
)[0];
```

Jika candidate ditemukan:

```txt
trigger hit
```

jika tidak:

```txt
tidak ada note yang dihitung
```

Optional:

```txt
ghost tap
```

tetapi jangan memberikan penalty kecuali gameplay sekarang memang mendukungnya.

---

## 10. Falling tile tidak perlu collision dengan finger

Penting:

Jangan melakukan collision antara:

```txt
finger mesh
VS
falling tile mesh
```

karena tile bergerak dan hand tracking noisy.

Falling tile hanya merupakan visualisasi waktu.

Hit terjadi ketika:

```txt
note mencapai timing window
+
finger menekan hitbox lane yang sesuai
```

Dengan demikian:

```txt
MIDI / Chart
     ↓
note.timeSec
     ↓
falling tile animation
     ↓
hit line
```

dan:

```txt
Camera
     ↓
MediaPipe
     ↓
finger screen position
     ↓
lane screen hitbox
     ↓
press gesture
```

kemudian kedua flow bertemu pada:

```txt
HitDetector
```

---

## 11. Arsitektur yang diinginkan

Saya menyarankan flow berikut:

```txt
MediaPipe Hand Landmarker
        ↓
HandTracker
        ↓
cameraIndexTip
        ↓
FingerInteractionController
        ↓
Screen-Space Hitbox Detection
        ↓
laneIndex
        ↓
press event
        ↓
HitDetector
        ↓
active note + timing window
        ↓
PERFECT / GOOD / MISS
        ↓
Sound + VFX + Score
```

Jika perlu buat module baru:

```txt
src/engine/fingerInteraction.js
```

atau:

```txt
src/engine/screenHitDetector.js
```

Tetapi jangan membuat module baru jika perubahan kecil pada architecture existing sudah cukup.

Prioritaskan clean separation of responsibility.

---

## 12. Existing HitDetector

`src/engine/hitDetector.js` sekarang memiliki logic seperti:

```txt
mapHandToLane()
checkCrossing()
evaluateCrossingHit()
```

Jangan langsung menghapusnya.

Refactor agar `HitDetector` bisa menerima dua jenis input:

```txt
3D crossing input
```

dan:

```txt
screen-space lane press input
```

Contoh API baru:

```js
evaluateLanePress(
    lane,
    currentTimeSec,
    activeNotes
)
```

`evaluateCrossingHit()` boleh dipertahankan sebagai legacy/fallback.

Dengan begitu scoring/timing candidate selection tidak terduplikasi.

---

## 13. Hitbox visual debug mode

Tambahkan debug mode agar kita dapat melihat apakah algoritma bekerja.

Misalnya:

```js
const DEBUG_HAND_HITBOX = true;
```

Saat aktif tampilkan overlay:

```txt
[ lane 0 ]
[ lane 1 ]
[ lane 2 ]
[ lane 3 ]
...
```

dengan semi-transparent rectangles.

Tampilkan juga:

```txt
● fingertip
```

di posisi MediaPipe yang sebenarnya.

Warna debug:

```txt
normal lane       -> transparent/blue
finger hover      -> yellow
press detected    -> cyan
successful hit    -> green
wrong/no note     -> red optional
```

Tampilkan debug text kecil:

```txt
Hand: Right
Finger: Index
Screen X: ...
Screen Y: ...
Lane: 5
Velocity Y: ...
State: PRESSING
Candidate: G4
Delta: -34 ms
Judgement: PERFECT
```

Debug overlay harus dapat dimatikan dan tidak memengaruhi gameplay.

---

## 14. Calibration / forgiveness

Hand tracking kamera memiliki noise.

Gunakan smoothing existing dari `HandTracker`.

Tambahkan hitbox forgiveness.

Misalnya:

```js
hitboxPaddingX = laneWidth * 0.10;
hitboxPaddingY = hitboxHeight * 0.15;
```

Jangan memperbesar hitbox sampai overlap besar antar lane.

Jika hitbox overlap, pilih lane dengan jarak fingertip ke center lane paling kecil.

Formula:

```js
distance = Math.abs(fingerX - hitbox.centerX);
```

Pilih distance terkecil.

---

## 15. Two hand mode

Untuk 8 lane, pertahankan semantic saat ini jika project memang menggunakannya:

```txt
Left hand  -> lane 0–3
Right hand -> lane 4–7
```

Gunakan handedness untuk membatasi candidate lane.

Contoh:

```js
if (hand === "Left" && lane > 3)
    reject;

if (hand === "Right" && lane < 4)
    reject;
```

Tetapi buat constraint tersebut configurable supaya nantinya kedua tangan dapat memainkan seluruh keyboard jika dibutuhkan.

---

## 16. Chord support

Jangan rusak chord system existing.

Jika terdapat simultaneous notes:

```txt
lane 1 + lane 4 + lane 6
```

maka setiap lane boleh menerima finger hit secara independen dalam chord timing window.

Track chord progress:

```txt
1 / 3
2 / 3
3 / 3
```

Kemudian gunakan chord completeness scoring existing.

Jangan tandai seluruh chord sebagai `played` hanya karena satu lane terkena jika struktur chart merepresentasikan chord sebagai satu parent object.

Jika current implementation melakukan hal tersebut, refactor menjadi per-lane/per-child hit state.

---

## 17. Tile synchronization

Tile visual harus menyentuh hit line tepat pada:

```js
currentSongTime === note.timeSec
```

Jangan menggunakan posisi rendered tile sebagai source timing.

Gunakan song clock sebagai source timing.

Posisi tile hanya derived visualization:

```js
tileZ = calculateTileZPosition(
    note.timeSec,
    currentSongTime,
    hitPlaneZ,
    tileSpeed
);
```

---

## 18. Latency compensation

MediaPipe + camera + rendering menambahkan latency.

Sediakan configurable parameter:

```js
inputLatencyCompensationSec
```

Default awal:

```js
0.04
```

Contoh evaluation:

```js
const evaluatedTime =
    currentSongTime + inputLatencyCompensationSec;
```

Jangan hardcode final value.

Gunakan configuration sehingga nanti bisa dituning antara:

```txt
0–100 ms
```

---

## 19. Performance

Jangan:

```txt
- screenshot canvas setiap frame
- melakukan OCR
- melakukan image segmentation kedua
- mendeteksi tile dari pixel
- membaca framebuffer Three.js untuk collision
```

Tidak diperlukan.

Target:

```txt
MediaPipe ~30 FPS
Three.js ~60 FPS jika device memungkinkan
```

Hitbox calculation harus ringan.

Projection ulang hitbox hanya ketika diperlukan:

```txt
camera transform berubah
arena transform berubah
viewport resize
orientation berubah
lane count berubah
calibration berubah
```

atau dilakukan setiap frame jika overhead-nya terbukti sangat kecil.

---

## 20. Prioritas UX

Player harus merasakan:

```txt
Saya melihat key piano.
Saya arahkan jari ke key tersebut.
Saya melakukan gerakan tap/down.
Tile tiba di hit line.
Jika timing dan lane benar -> note berbunyi.
```

Player tidak perlu memahami coordinate Z atau benar-benar menyentuh piano virtual secara fisik.

Illusion visual lebih penting daripada collision 3D literal.

---

## 21. Acceptance criteria

Implementasi dianggap berhasil jika:

1. Fingertip MediaPipe terlihat sesuai posisi tangan asli pada kamera.

2. Setiap piano lane mempunyai screen-space hitbox yang mengikuti posisi visual piano.

3. Saat pemain memindahkan tangan, lane hover mengikuti fingertip dengan benar.

4. Tangan diam di atas lane tidak menyebabkan auto-hit.

5. Gerakan tap/down menghasilkan satu press event.

6. Press lane yang benar tetapi terlalu cepat tidak dihitung.

7. Press lane yang benar dalam ±50 ms menghasilkan PERFECT.

8. Press lane yang benar dalam ±120 ms menghasilkan GOOD.

9. Note yang tidak dipukul melewati window menjadi MISS.

10. Press pada lane salah tidak memukul note lain.

11. 4-lane mode tetap bekerja.

12. 8-lane/two-hand mode tetap bekerja.

13. Chord tetap dapat dinilai.

14. Existing audio, VFX, score, combo, song selector, calibration, dan MIDI/chart system tidak rusak.

15. Tidak ada image recognition kedua untuk membaca posisi tile dari layar.

16. Semua coordinate transform terdokumentasi dengan jelas.

---

## 22. Testing

Tambahkan unit tests untuk logic yang tidak membutuhkan browser jika memungkinkan.

Minimal test:

```txt
screen point -> lane
outside hitbox -> no lane
overlap -> nearest lane
stationary finger -> no press
downward movement -> press
press cooldown
correct lane + correct timing -> PERFECT
correct lane + late timing -> GOOD
correct lane + outside timing -> null
wrong lane -> null
simultaneous chord lanes
```

Jangan menghapus test existing.

---

## 23. Development strategy

Kerjakan secara bertahap.

### Phase 1

Tambahkan projection dan debug hitboxes.

Belum perlu scoring.

Pastikan fingertip MediaPipe dan piano lane berada dalam coordinate space layar yang sama.

### Phase 2

Tambahkan finger hover dan lane selection.

### Phase 3

Tambahkan press/downstroke detection.

### Phase 4

Integrasikan dengan `HitDetector`.

### Phase 5

Integrasikan scoring, sound, VFX, chord.

### Phase 6

Tune threshold, forgiveness, latency compensation.

---

## 24. Sebelum coding

Sebelum melakukan perubahan, jelaskan terlebih dahulu:

1. bagaimana current hand tracking flow bekerja,
2. bagaimana current hit detection bekerja,
3. bagaimana tile position dihitung,
4. bagian mana yang akan diubah,
5. file mana yang akan disentuh,
6. kenapa pendekatan screen-space lebih cocok dibanding collision 3D pada kondisi ini.

Setelah itu baru implementasikan.

Jangan rewrite seluruh project.

Jangan mengubah UI besar-besaran.

Jangan mengganti MediaPipe.

Jangan mengganti Three.js.

Jangan mengganti format chart/MIDI kecuali benar-benar diperlukan.

Tujuan utama perubahan ini adalah membuat interaksi tangan terasa natural, stabil, dan sesuai dengan piano/tile yang terlihat oleh pemain.