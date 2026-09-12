# AR Perang Pasir Berbasis Kartu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengubah proyek menjadi AR berbasis kartu yang berjalan di Chrome desktop dengan webcam, di mana enam kartu fisik menjadi jangkar dan pertarungan pasir terjadi di atas meja.

**Architecture:** MindAR image tracking membaca enam kartu dan melaporkan pose. Arena adalah satu bidang bersama yang dikalibrasi dari posisi kartu, dan unit bergerak bebas di bidang itu. Domain pertarungan dipisahkan di `src/core/` sebagai logika murni tanpa Three.js.

**Tech Stack:** Vite 7, vanilla JavaScript (ESM), Three.js 0.180, MindAR image tracking, `@strudel/web` 1.3, Node test runner.

## Global Constraints

- Target rilis: Chrome desktop dengan webcam. WebXR `immersive-ar` tidak tersedia di desktop dan TIDAK boleh dipakai.
- Mode markerless, hit-test, reticle, dan `src/ar/ar-markerless.js` dihapus dari rilis.
- Enam kartu: `benteng`, `bunker`, `robot`, `tank`, `kesatria`, `gargoyle`.
- Tiga peran: `base` (benteng, bunker), `artileri` (robot, tank), `prajurit` (kesatria, gargoyle).
- Setiap tim wajib tepat satu base, satu artileri, dan satu prajurit.
- Urutan peletakan kartu bebas. Tim ditentukan oleh sisi kartu relatif terhadap garis tengah.
- Pemain tidak memiliki aksi selama battle. Hanya menonton, lalu boleh mengulang.
- Kartu tidak bergerak saat battle. Unit muncul di atas kartunya lalu berjalan keluar.
- Statistik: benteng 200 HP, bunker 200 HP, robot 120 HP/16 dmg, tank 100 HP/20 dmg, kesatria 70 HP/14 dmg, gargoyle 60 HP/12 dmg.
- Serangan dua arah. Setiap unit dapat menyerang dan menjadi sasaran.
- Pertarungan deterministik untuk komposisi dan posisi kartu yang sama.
- Battle berakhir ketika salah satu base hancur.
- `src/core/` tidak boleh mengimpor `three`, DOM, atau library pelacakan.
- Tidak ada aturan summon, cooldown 8 detik, atau tombol reinforcement.
- Folder proyek tidak memiliki Git. Jangan membuat commit; verifikasi dengan `npm test` dan `npm run build`.

---

## Task 1: Model domain pertarungan baru di `src/core/`

**Files:**
- Modify: `src/core/unit-definitions.js`
- Create: `src/core/team-composition.js`
- Create: `src/core/arena-layout.js`
- Create: `tests/core/team-composition.test.js`

**Interfaces:**
- Consumes: tidak ada.
- Produces: `UNIT_DEFINITIONS` dengan field baru `role` bernilai `'base' | 'artileri' | 'prajurit'`, plus `range` dan `speed` per unit.
- Produces: `CARD_TO_TYPE` map dari nama kartu kartu fisik ke tipe unit.
- Produces: `ROLE_REQUIREMENTS = { base: 1, artileri: 1, prajurit: 1 }`.
- Produces: `classifySide(x, centerX) -> 'blue' | 'red' | null`.
- Produces: `validateTeams(cards) -> { valid, errors, bySide }` di mana `cards` adalah array `{ cardId, type, x }`.
- Produces: `deriveArena(cards, options) -> { centerX, centerZ, width, depth, blueAnchor, redAnchor, scale }`.

- [ ] **Step 1: Tulis tes yang gagal untuk komposisi tim**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySide, validateTeams } from '../../src/core/team-composition.js';

const cards = [
  { cardId: 'benteng', type: 'benteng', x: -0.4 },
  { cardId: 'robot', type: 'robot', x: -0.1 },
  { cardId: 'kesatria', type: 'kesatria', x: -0.25 },
  { cardId: 'bunker', type: 'bunker', x: 0.4 },
  { cardId: 'tank', type: 'tank', x: 0.1 },
  { cardId: 'gargoyle', type: 'gargoyle', x: 0.25 }
];

test('side is decided by position relative to the centre line', () => {
  assert.equal(classifySide(-0.2, 0), 'blue');
  assert.equal(classifySide(0.2, 0), 'red');
  assert.equal(classifySide(0, 0), null);
});

test('a valid layout needs one base, one artileri and one prajurit per side', () => {
  assert.equal(validateTeams(cards).valid, true);
});

test('a side with two bases is rejected', () => {
  const broken = [...cards.filter(card => card.type !== 'robot'), { cardId: 'bunker', type: 'bunker', x: -0.1 }];
  const result = validateTeams(broken);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /Biru/);
});

test('a missing prajurit is reported per side', () => {
  const broken = cards.filter(card => card.type !== 'kesatria');
  const result = validateTeams(broken);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /prajurit/i);
});

test('cards on the centre line are rejected', () => {
  const result = validateTeams([...cards, { cardId: 'tank', type: 'tank', x: 0 }]);
  assert.equal(result.valid, false);
});
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `node --test tests/core/team-composition.test.js`
Expected: FAIL karena `src/core/team-composition.js` belum ada.

- [ ] **Step 3: Perbarui `src/core/unit-definitions.js`**

Ganti isi berkas dengan definisi enam unit, masing-masing memiliki `role`, `title`, `maxHealth`, `damage`, `range`, dan `speed`. Peran wajib `'base'`, `'artileri'`, atau `'prajurit'`.

```js
export const ROLES = Object.freeze(['base', 'artileri', 'prajurit']);
export const FACTIONS = Object.freeze(['blue', 'red']);

export const UNIT_DEFINITIONS = Object.freeze({
  benteng: { role: 'base', title: 'Benteng Pasir', maxHealth: 200, damage: 0, range: 0, speed: 0 },
  bunker: { role: 'base', title: 'Bunker Berduri', maxHealth: 200, damage: 0, range: 0, speed: 0 },
  robot: { role: 'artileri', title: 'Robot Pasir', maxHealth: 120, damage: 16, range: 3.2, speed: 1.1 },
  tank: { role: 'artileri', title: 'Tank Pasir', maxHealth: 100, damage: 20, range: 3.8, speed: 0.9 },
  kesatria: { role: 'prajurit', title: 'Kesatria Pasir', maxHealth: 70, damage: 14, range: 1.1, speed: 2.2 },
  gargoyle: { role: 'prajurit', title: 'Gargoyle Pasir', maxHealth: 60, damage: 12, range: 1.4, speed: 2.6 }
});

export const CARD_TO_TYPE = Object.freeze({
  benteng: 'benteng', bunker: 'bunker', robot: 'robot',
  tank: 'tank', kesatria: 'kesatria', gargoyle: 'gargoyle'
});

export const CARD_IDS = Object.freeze(Object.keys(CARD_TO_TYPE));
```

- [ ] **Step 4: Tulis `src/core/team-composition.js`**

```js
import { FACTIONS, ROLES, UNIT_DEFINITIONS } from './unit-definitions.js';

export const ROLE_REQUIREMENTS = Object.freeze({ base: 1, artileri: 1, prajurit: 1 });

export function classifySide(x, centerX = 0) {
  if (!Number.isFinite(x)) return null;
  if (x < centerX) return 'blue';
  if (x > centerX) return 'red';
  return null;
}

export function validateTeams(cards) {
  const errors = [];
  const bySide = { blue: [], red: [] };
  const seen = new Set();

  for (const card of cards || []) {
    const type = card?.type ?? null;
    const definition = UNIT_DEFINITIONS[type];
    if (!definition) { errors.push('Kartu tidak dikenal.'); continue; }
    if (seen.has(card.cardId)) { errors.push(`Kartu ${definition.title} terdeteksi dua kali.`); continue; }
    const side = classifySide(card.x, card.centerX ?? 0);
    if (!side) { errors.push(`Kartu ${definition.title} berada tepat di garis tengah.`); continue; }
    seen.add(card.cardId);
    bySide[side].push({ ...card, role: definition.role });
  }

  for (const faction of FACTIONS) {
    const label = faction === 'blue' ? 'Biru' : 'Merah';
    const list = bySide[faction];
    if (list.length !== 3) errors.push(`Tim ${label} membutuhkan tepat tiga kartu.`);
    for (const role of ROLES) {
      const count = list.filter(card => card.role === role).length;
      if (count !== ROLE_REQUIREMENTS[role]) {
        errors.push(`Tim ${label} membutuhkan tepat ${ROLE_REQUIREMENTS[role]} ${role}.`);
      }
    }
  }
  return { valid: errors.length === 0, errors, bySide };
}
```

- [ ] **Step 5: Tulis `src/core/arena-layout.js`**

```js
import { classifySide } from './team-composition.js';

export const DEFAULT_ARENA = Object.freeze({ halfWidth: 6, halfDepth: 4, cardScale: 0.32 });

export function deriveArena(cards, options = {}) {
  const list = (cards || []).filter(card => Array.isArray(card.worldPosition));
  const fallback = { centerX: 0, centerZ: 0, width: DEFAULT_ARENA.halfWidth * 2, depth: DEFAULT_ARENA.halfDepth * 2, scale: 1, blueAnchor: [-3, 0, 0], redAnchor: [3, 0, 0] };
  if (list.length === 0) return fallback;

  const xs = list.map(card => card.worldPosition[0]);
  const zs = list.map(card => card.worldPosition[2]);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerZ = (Math.min(...zs) + Math.max(...zs)) / 2;
  const spanX = Math.max(Math.max(...xs) - Math.min(...xs), 1);
  const spanZ = Math.max(Math.max(...zs) - Math.min(...zs), 1);
  const scale = Math.max(0.35, Math.min(2.5, spanX / (DEFAULT_ARENA.halfWidth * 2)));

  const blue = list.filter(card => classifySide(card.worldPosition[0], centerX) === 'blue');
  const red = list.filter(card => classifySide(card.worldPosition[0], centerX) === 'red');
  const average = (group, axis) => group.length ? group.reduce((sum, card) => sum + card.worldPosition[axis], 0) / group.length : centerX;

  return {
    centerX, centerZ,
    width: spanX, depth: spanZ, scale,
    blueAnchor: [average(blue, 0), 0, centerZ],
    redAnchor: [average(red, 0), 0, centerZ]
  };
}
```

- [ ] **Step 6: Jalankan tes**

Run: `node --test tests/core/team-composition.test.js`
Expected: PASS lima tes.

- [ ] **Step 7: Verifikasi tidak ada impor terlarang**

Run: `rg "from 'three'" src/core` dan `rg "\.\./" src/core`
Expected: tidak ada keluaran.

---

## Task 2: Domain pertarungan peran berbasis jarak

**Files:**
- Create: `src/core/battle-field.js`
- Modify: `src/core/battle-system.js`
- Create: `tests/core/battle-field.test.js`

**Interfaces:**
- Consumes: `UNIT_DEFINITIONS` dari Task 1.
- Produces: `class BattleField` dengan `constructor(state)`, `distance(unitA, unitB)`, `targetFor(unit)`, `advance(unit, dt)`, `canAttack(unit, target)`, `isInRange(unit, target)`.
- Produces: `BattleSystem` versi baru dengan `configure({ units })`, `start()`, `update(dt)`, `snapshot()`, `baseHealth()`, `unitTitle(unitId)`, dan event `battle-start`, `attack`, `impact`, `move`, `destroy`, `victory`.
- Setiap unit dalam state memiliki: `id`, `type`, `faction`, `role`, `health`, `maxHealth`, `cooldown`, `position: { x, z }`, `targetId`, `alive`.

- [ ] **Step 1: Tulis tes yang gagal untuk pemilihan target dan jangkauan**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleField } from '../../src/core/battle-field.js';

const unit = (id, role, faction, x, z) => ({ id, type: role === 'base' ? 'benteng' : role === 'artileri' ? 'tank' : 'kesatria', role, faction, position: { x, z }, alive: true });

test('a unit picks the nearest living enemy in range', () => {
  const field = new BattleField({
    units: [
      unit('blue-a', 'artileri', 'blue', 0, 0),
      unit('red-near', 'prajurit', 'red', 2, 0),
      unit('red-far', 'base', 'red', 6, 0)
    ]
  });
  assert.equal(field.targetFor(field.units.get('blue-a')).id, 'red-near');
});

test('a prajurit only attacks in melee range', () => {
  const field = new BattleField({
    units: [unit('blue-p', 'prajurit', 'blue', 0, 0), unit('red-b', 'base', 'red', 5, 0)]
  });
  assert.equal(field.isInRange(field.units.get('blue-p'), field.units.get('red-b')), false);
});

test('units advance toward the enemy when nothing is in range', () => {
  const field = new BattleField({
    units: [unit('blue-p', 'prajurit', 'blue', 0, 0), unit('red-b', 'base', 'red', 5, 0)]
  });
  const prajurit = field.units.get('blue-p');
  field.advance(prajurit, 1);
  assert.ok(prajurit.position.x > 0);
});
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `node --test tests/core/battle-field.test.js`
Expected: FAIL karena modul belum ada.

- [ ] **Step 3: Tulis `src/core/battle-field.js`**

Implementasikan `class BattleField` dengan `units` sebagai `Map`, menghitung jarak Euclidean pada bidang `x`/`z`, memilih target hidup terdekat yang berada dalam `range` definisi unitnya, dan `advance(unit, dt)` yang menggerakkan unit ke arah base musuh dengan kecepatan `speed` bila tidak ada target dalam jangkauan. Base tidak pernah bergerak karena `speed` bernilai 0.

- [ ] **Step 4: Tulis ulang `src/core/battle-system.js`**

`BattleSystem.configure` menerima `{ units }` berisi daftar unit hasil kalibrasi arena, menyimpan `BattleField`, dan `update(dt)` setiap frame melakukan: kurangi cooldown, pilih target, bila target dalam jangkauan serang maka emit `attack` lalu `impact` dan kurangi health target, bila tidak maka `advance` dan emit `move`. Pertahankan `baseHealth()`, `unitTitle()`, dan event `victory` ketika salah satu base hancur. Hapus seluruh aturan summon, `summon()`, dan cooldown delapan detik.

- [ ] **Step 5: Jalankan tes**

Run: `node --test tests/core/battle-field.test.js`
Expected: PASS tiga tes.

- [ ] **Step 6: Perbarui tes battle lama**

Ubah `tests/core/battle-system.test.js` agar memakai bentuk `{ units }` yang baru, dan hapus tes summon. Pertahankan tes determinisme dan kondisi kemenangan.

Run: `npm test`
Expected: PASS seluruh tes core.

---

## Task 3: Kartu cetak dan berkas target

**Files:**
- Create: `public/cards/*.svg` (enam berkas)
- Create: `public/cards/lembar-a4.svg`
- Create: `public/cards/README.md`
- Create: `scripts/build-targets.mjs`
- Create: `src/ar/card-targets.js`

**Interfaces:**
- Produces: enam berkas gambar kartu berfitur tinggi dan satu lembar A4 siap potong.
- Produces: `TARGET_SRC` dengan jalur gambar, dan `loadTargets()` yang memuat berkas target terkompilasi.
- Produces: `CARD_TYPES` memetakan indeks target ke tipe unit.

- [ ] **Step 1: Buat enam gambar kartu SVG di `public/cards/`**

Setiap kartu berukuran 600x850 dengan bingkai bermotif pasir dan geometri tidak simetris supaya orientasi dapat ditentukan. Kartu memuat ilustrasi sederhana unit, nama, dan label peran. Nama berkas: `benteng.svg`, `bunker.svg`, `robot.svg`, `tank.svg`, `kesatria.svg`, `gargoyle.svg`.

Ketentuan wajib setiap kartu:

- Tepi luar bergaris tebal dua lapis dengan sudut terpotong berbeda di setiap sisi.
- Pola geometri bervariasi (busur, garis diagonal, titik) di dalam bingkai, bukan bidang polos.
- Warna berbeda per peran: base biru tua, artileri jingga, prajurit hijau tua, dan setiap kartu punya aksen unik.
- Ilustrasi unit memakai bentuk geometris sederhana, bukan gambar detail.
- Label peran tercetak jelas untuk dibaca manusia.

- [ ] **Step 2: Buat `public/cards/lembar-a4.svg`**

Satu lembar A4 potrait berisi keenam kartu dalam susunan tiga kolom dua baris, dengan tanda potong di setiap sudut kartu dan judul lembar.

- [ ] **Step 3: Buat `scripts/build-targets.mjs`**

Skrip Node yang mengompilasi enam gambar kartu menjadi satu berkas target, menulis hasilnya ke `public/cards/targets.mind`, dan mencetak ringkasan hasil. Bila proses kompilasi memerlukan perkakas eksternal, skrip harus menjelaskannya dan keluar dengan pesan yang jelas, bukan gagal tanpa penjelasan.

- [ ] **Step 4: Buat `src/ar/card-targets.js`**

```js
export const CARD_TARGETS = Object.freeze([
  { cardId: 'benteng', type: 'benteng', src: '/cards/benteng.svg' },
  { cardId: 'bunker', type: 'bunker', src: '/cards/bunker.svg' },
  { cardId: 'robot', type: 'robot', src: '/cards/robot.svg' },
  { cardId: 'tank', type: 'tank', src: '/cards/tank.svg' },
  { cardId: 'kesatria', type: 'kesatria', src: '/cards/kesatria.svg' },
  { cardId: 'gargoyle', type: 'gargoyle', src: '/cards/gargoyle.svg' }
]);

export const TARGET_FILE = '/cards/targets.mind';

export function typeForCard(cardId) {
  return CARD_TARGETS.find(card => card.cardId === cardId)?.type ?? null;
}
```

- [ ] **Step 5: Tulis `public/cards/README.md`**

Jelaskan cara mencetak lembar A4, ukuran cetak yang disarankan sekitar 9 cm per kartu, pentingnya pencahayaan rata, dan cara menjalankan skrip kompilasi target.

- [ ] **Step 6: Verifikasi**

Run: `npm run build`
Expected: build sukses dan berkas di `public/cards/` tersalin ke keluaran build.

---

## Task 4: Adapter pelacakan kartu

**Files:**
- Rewrite: `src/ar/ar-marker.js`
- Delete: `src/ar/ar-markerless.js`
- Modify: `src/ar/capabilities.js`
- Create: `tests/ar/card-tracking.test.js`

**Interfaces:**
- Consumes: `CARD_TARGETS`, `TARGET_FILE` dari Task 3; `deriveArena` dari Task 1.
- Produces: `class CardTrackingController` dengan `constructor({ container, onCards, onError })`, `isSupported()`, `start()`, `stop()`, `dispose()`, dan `cards` sebagai `Map`.
- Produces: `describeCard(cardId)` yang mengembalikan `{ cardId, type, role }`.
- Produces: `detectCapabilities` yang hanya melaporkan `cardTracking` dan `camera`.

- [ ] **Step 1: Tulis tes yang gagal**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDetections } from '../../src/ar/card-tracking.js';

test('normalizes raw detections into card records', () => {
  const cards = normalizeDetections([
    { targetIndex: 0, worldPosition: [0.1, 0, 0.2] },
    { targetIndex: 3, worldPosition: [-0.4, 0, 0.1] }
  ]);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].cardId, 'benteng');
  assert.equal(cards[0].type, 'benteng');
  assert.equal(cards[0].role, 'base');
  assert.equal(cards[1].cardId, 'tank');
  assert.equal(cards[1].role, 'artileri');
});

test('unknown indexes are ignored instead of throwing', () => {
  const cards = normalizeDetections([{ targetIndex: 99, worldPosition: [0, 0, 0] }]);
  assert.deepEqual(cards, []);
});
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `node --test tests/ar/card-tracking.test.js`
Expected: FAIL karena modul belum ada.

- [ ] **Step 3: Buat `src/ar/card-tracking.js`**

Ekspor `normalizeDetections(rawList)` yang memetakan `targetIndex` ke entri `CARD_TARGETS`, mengabaikan indeks tak dikenal, dan mengembalikan `{ cardId, type, role, worldPosition }`. Peran diambil dari `UNIT_DEFINITIONS[type].role`.

- [ ] **Step 4: Tulis ulang `src/ar/ar-marker.js`**

Ganti `ARMarkerController` menjadi `CardTrackingController` yang:

- Membuat container MindAR pada elemen yang diberikan dan memuat `TARGET_FILE`.
- Mendengarkan peristiwa target ditemukan dan target hilang, lalu memperbarui `this.cards` sebagai `Map` dari `cardId` ke `{ type, role, worldPosition, pose }`.
- Memanggil `onCards([...this.cards.values()])` setiap kali daftar berubah.
- `start()` meminta kamera dan memulai pelacakan; bila gagal, memanggil `onError` dan melempar.
- `dispose()` menghentikan sesi, melepas track kamera, dan membuang container.

Karena runtime pelacakan hanya tersedia di browser, impor pustaka pelacakan harus dilakukan secara dinamis di dalam `start()` sehingga modul tetap aman diuji di Node.

- [ ] **Step 5: Perbarui `src/ar/capabilities.js`**

Ganti isi sehingga hanya mengembalikan `{ cardTracking, camera, secureContext, reasons }`. `cardTracking` bernilai true bila kamera tersedia dan konteks aman. Hapus semua logika `immersive-ar` dan `markerless`.

- [ ] **Step 6: Hapus `src/ar/ar-markerless.js`**

- [ ] **Step 7: Jalankan tes**

Run: `node --test tests/ar/card-tracking.test.js` dan `npm test`
Expected: PASS.

---

## Task 5: HP bar 3D dan label unit

**Files:**
- Create: `src/scene/unit-hud.js`
- Create: `tests/scene/unit-hud.test.js`

**Interfaces:**
- Consumes: `THREE`.
- Produces: `healthBarWidth(health, maxHealth) -> number` dalam rentang 0 sampai 1.
- Produces: `factionColor(faction) -> number` mengembalikan `0x176db2` untuk blue dan `0xbd4b3c` untuk red.
- Produces: `class UnitHud` dengan `constructor(root)`, `attach(unitId, object3D, meta)`, `setHealth(unitId, health, maxHealth)`, `setTarget(unitId, targetId)`, `detach(unitId)`, `update(camera)`, `dispose()`.

- [ ] **Step 1: Tulis tes yang gagal**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { factionColor, healthBarWidth } from '../../src/scene/unit-hud.js';

test('health bar width maps health onto a 0..1 range', () => {
  assert.equal(healthBarWidth(100, 100), 1);
  assert.equal(healthBarWidth(50, 100), 0.5);
  assert.equal(healthBarWidth(0, 100), 0);
});

test('health bar width clamps out of range values', () => {
  assert.equal(healthBarWidth(-10, 100), 0);
  assert.equal(healthBarWidth(999, 100), 1);
  assert.equal(healthBarWidth(10, 0), 0);
});

test('faction colour is blue for blue and red for red', () => {
  assert.equal(factionColor('blue'), 0x176db2);
  assert.equal(factionColor('red'), 0xbd4b3c);
});
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `node --test tests/scene/unit-hud.test.js`
Expected: FAIL karena modul belum ada.

- [ ] **Step 3: Tulis `src/scene/unit-hud.js`**

Implementasikan `healthBarWidth` dan `factionColor` sebagai fungsi murni. Implementasikan `class UnitHud` yang untuk setiap unit membuat sebuah `THREE.Sprite` berisi latar gelap, isi berwarna sesuai tim, dan label nama. `update(camera)` membuat setiap sprite selalu menghadap kamera dan menjaga ukuran tetap layar. `setHealth` mengubah lebar isi berdasarkan `healthBarWidth`. `detach` membuang sprite dari scene dan membebaskan material serta tekstur.

- [ ] **Step 4: Jalankan tes**

Run: `node --test tests/scene/unit-hud.test.js`
Expected: PASS tiga tes.

---

## Task 6: Pergerakan unit di bidang arena

**Files:**
- Modify: `src/scene/units/base-unit.js`
- Create: `src/scene/unit-motion.js`
- Create: `tests/scene/unit-motion.test.js`

**Interfaces:**
- Consumes: `UNIT_DEFINITIONS` dari Task 1.
- Produces: `MOTION_STATES = ['hidden','spawning','walking','attacking','hit','collapsing','dead']`.
- Produces: `nextMotionState(current, event) -> string` sebagai fungsi transisi murni.
- Produces: `advanceToward(from, to, distance) -> { x, z }` yang mengembalikan posisi baru tanpa melewati tujuan.

- [ ] **Step 1: Tulis tes yang gagal**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceToward, nextMotionState } from '../../src/scene/unit-motion.js';

test('advanceToward never overshoots the destination', () => {
  const arrived = advanceToward({ x: 0, z: 0 }, { x: 10, z: 0 }, 3);
  assert.equal(arrived.x, 3);
  assert.equal(arrived.z, 0);
  const clamped = advanceToward({ x: 0, z: 0 }, { x: 1, z: 0 }, 5);
  assert.equal(clamped.x, 1);
});

test('advanceToward handles a zero distance target', () => {
  const same = advanceToward({ x: 2, z: 2 }, { x: 2, z: 2 }, 3);
  assert.deepEqual(same, { x: 2, z: 2 });
});

test('motion state machine follows spawn, walk, attack and death', () => {
  assert.equal(nextMotionState('hidden', 'spawn'), 'spawning');
  assert.equal(nextMotionState('spawning', 'ready'), 'walking');
  assert.equal(nextMotionState('walking', 'inRange'), 'attacking');
  assert.equal(nextMotionState('attacking', 'outOfRange'), 'walking');
  assert.equal(nextMotionState('attacking', 'damaged'), 'hit');
  assert.equal(nextMotionState('hit', 'recovered'), 'attacking');
  assert.equal(nextMotionState('walking', 'killed'), 'collapsing');
  assert.equal(nextMotionState('collapsing', 'settled'), 'dead');
});
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `node --test tests/scene/unit-motion.test.js`
Expected: FAIL karena modul belum ada.

- [ ] **Step 3: Tulis `src/scene/unit-motion.js`**

Implementasikan `MOTION_STATES`, `nextMotionState(current, event)` dengan tabel transisi yang persis mengikuti tes, dan `advanceToward(from, to, distance)` yang menghitung arah ternormalisasi lalu membatasi langkah agar tidak melewati titik tujuan.

- [ ] **Step 4: Sesuaikan `src/scene/units/base-unit.js`**

Tambahkan dukungan posisi dunia: metode `moveTo(x, z)` yang memindahkan `group.position`, dan `faceTowards(x, z)` yang memutar `group.rotation.y` menghadap arah gerak. Pertahankan seluruh state pasir, grain, dan collapse yang sudah ada.

- [ ] **Step 5: Jalankan tes**

Run: `node --test tests/scene/unit-motion.test.js`
Expected: PASS tiga tes.

---

## Task 7: Arena, garis panduan, dan panduan peletakan

**Files:**
- Modify: `src/scene/scene-system.js`
- Create: `src/scene/arena-mesh.js`
- Create: `src/scene/guide-lines.js`
- Create: `tests/scene/arena-mesh.test.js`

**Interfaces:**
- Consumes: `deriveArena` dari Task 1.
- Produces: `sceneBoundsFromArena(arena) -> { halfWidth, halfDepth }`.
- Produces: `guideLineX(arena) -> [leftX, centerX, rightX]`.
- Produces: `class ArenaMesh` dengan `constructor(root)`, `apply(arena)`, `dispose()`.
- Produces: `class GuideLines` dengan `constructor(root)`, `show(arena)`, `hide()`, `dispose()`.

- [ ] **Step 1: Tulis tes yang gagal**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { guideLineX, sceneBoundsFromArena } from '../../src/scene/arena-mesh.js';

test('scene bounds follow the calibrated arena', () => {
  const bounds = sceneBoundsFromArena({ width: 6, depth: 4 });
  assert.equal(bounds.halfWidth, 3);
  assert.equal(bounds.halfDepth, 2);
});

test('scene bounds never collapse to zero', () => {
  const bounds = sceneBoundsFromArena({ width: 0, depth: 0 });
  assert.ok(bounds.halfWidth > 0);
  assert.ok(bounds.halfDepth > 0);
});

test('guide lines produce left, centre and right positions', () => {
  const [left, center, right] = guideLineX({ centerX: 0, width: 6 });
  assert.equal(center, 0);
  assert.ok(left < center);
  assert.ok(right > center);
});
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `node --test tests/scene/arena-mesh.test.js`
Expected: FAIL karena modul belum ada.

- [ ] **Step 3: Tulis `src/scene/arena-mesh.js`**

Ekspor `sceneBoundsFromArena(arena)` yang mengubah `width`/`depth` arena menjadi setengah ukuran dengan nilai minimum agar tidak pernah nol, dan `guideLineX(arena)` yang mengembalikan posisi garis kiri, tengah, dan kanan. Implementasikan `class ArenaMesh` yang membuat bidang pasir, garis tengah, dan batas arena, lalu `apply(arena)` menyesuaikan ukuran serta posisinya.

- [ ] **Step 4: Tulis `src/scene/guide-lines.js`**

Implementasikan `class GuideLines` yang menggambar tiga garis tipis: garis tengah vertikal, dan dua garis zona selebar satu kartu di kiri dan kanan. Garis hanya tampil selama fase peletakan kartu.

- [ ] **Step 5: Perbarui `src/scene/scene-system.js`**

Arena dan garis panduan tidak lagi dibuat di dalam `createSceneSystem`; buat keduanya melalui kelas baru dan kembalikan sebagai bagian dari hasil, lalu `bootstrap` yang mengaturnya. Latar belakang scene harus transparan agar feed webcam terlihat di belakang objek 3D.

- [ ] **Step 6: Jalankan tes**

Run: `node --test tests/scene/arena-mesh.test.js` dan `npm test`
Expected: PASS.

---

## Task 8: Orkestrasi baru dan UI yang menyusut

**Files:**
- Rewrite: `src/app/game-controller.js`
- Modify: `src/app/bootstrap.js`
- Modify: `index.html`
- Rewrite: `src/ui/screens/screen-mode.js`
- Delete: `src/ui/screens/screen-roster.js`
- Delete: `src/ui/screens/screen-placement.js`
- Delete: `src/ui/screens/screen-build.js`
- Rewrite: `src/ui/screens/screen-battle.js`
- Modify: `src/ui/screens/screen-result.js`
- Modify: `src/ui/wizard.js`
- Modify: `src/ui/app-state.js`
- Delete: `src/ui/components/summon-zone.js`

**Interfaces:**
- Consumes: `CardTrackingController` dari Task 4, `BattleSystem` dari Task 2, `UnitHud` dari Task 5, `ArenaMesh` dan `GuideLines` dari Task 7.
- Produces: `PHASES = ['scan','scan','battle','result']` diganti menjadi `PHASES = ['camera','scan','battle','result']`.
- Produces: `createGameController({ canvas, video, root })`.

- [ ] **Step 1: Perbarui `src/ui/app-state.js`**

Ubah `PHASES` menjadi `['camera','scan','battle','result']` dan `MODES` dihapus karena hanya ada satu pengalaman. Transisi: `camera → scan`, `scan → battle`, `battle → result`, `result → scan`. Hapus `mode` dari state.

- [ ] **Step 2: Perbarui tes app-state**

Ubah `tests/ui/app-state.test.js` mengikuti fase baru dan hapus tes mode. Tes harus memverifikasi urutan fase, transisi yang sah, dan penolakan transisi tidak sah.

Run: `node --test tests/ui/app-state.test.js`
Expected: PASS.

- [ ] **Step 3: Tulis ulang `src/ui/screens/screen-mode.js` menjadi `src/ui/screens/screen-camera.js`**

Layar pertama berisi penjelasan singkat, tombol "Aktifkan Kamera", dan status izin. Menjelaskan bahwa pemain harus mencetak kartu terlebih dahulu.

- [ ] **Step 4: Tulis ulang layar scan menjadi `src/ui/screens/screen-scan.js`**

Menampilkan daftar enam kartu dengan status terdeteksi atau belum, pesan kesalahan komposisi tim yang spesifik, dan tombol "Mulai Battle" yang hanya aktif ketika keenam kartu valid.

- [ ] **Step 5: Tulis ulang `src/ui/screens/screen-battle.js`**

Layar battle tidak lagi memiliki summon zone. Hanya menyisakan HP bar 3D dari `UnitHud`, petunjuk bahwa pemain hanya menonton, dan menu kecil untuk mengulang.

- [ ] **Step 6: Sesuaikan `src/ui/screens/screen-result.js`**

Menampilkan pemenang dan tombol "Ulangi". Tidak ada tombol ganti roster.

- [ ] **Step 7: Perbarui `src/ui/wizard.js`**

Daftar `factories` mengikuti fase baru: `camera`, `scan`, `battle`, `result`.

- [ ] **Step 8: Tulis ulang `src/app/game-controller.js`**

Alur baru:

- `camera` → membuat `CardTrackingController`, memulai kamera, lalu pindah ke `scan`.
- `scan` → setiap kali `onCards` melaporkan perubahan, validasi dengan `validateTeams` dan `deriveArena`. Bila valid, aktifkan tombol mulai. Saat mulai, bangun unit dari kartu dan mulai battle.
- `battle` → `BattleSystem` baru dijalankan; event `move` menggerakkan model, `attack` memicu animasi serang, `impact` memperbarui HP bar dan efek hantaman, `destroy` memicu keruntuhan, `victory` menuju layar hasil.
- `result` → mengulang dari `scan` tanpa meminta izin kamera lagi.

Unit dibuat dari kartu: untuk setiap kartu yang valid, posisi awal model adalah posisi kartu hasil kalibrasi arena, lalu unit berjalan menuju arena.

- [ ] **Step 9: Perbarui `index.html` dan `src/app/bootstrap.js`**

`index.html` memuat elemen `<video>` untuk kamera dan `<canvas>` untuk Three.js, serta hanya `bootstrap.js` sebagai skrip modul. `bootstrap.js` meneruskan elemen video dan canvas ke `createGameController`.

- [ ] **Step 10: Hapus berkas yang tidak dipakai**

Hapus `src/ui/screens/screen-roster.js`, `screen-placement.js`, `screen-build.js`, dan `src/ui/components/summon-zone.js`. Perbarui tes komponen yang menyentuh `formatCooldown`.

- [ ] **Step 11: Verifikasi**

Run: `npm test` dan `npm run build`
Expected: keduanya sukses.

---

## Task 9: Animasi, efek, dan suara

**Files:**
- Modify: `src/scene/sand-effects.js`
- Modify: `src/audio/audio-system.js`
- Create: `tests/audio/sfx-events.test.js`

**Interfaces:**
- Consumes: event battle dari Task 2.
- Produces: `SFX_EVENTS` memetakan tipe event ke nama efek.
- Produces: `sfxFor(event) -> string | null`.

- [ ] **Step 1: Tulis tes yang gagal**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { sfxFor } from '../../src/audio/audio-system.js';

test('battle events map to sound effects', () => {
  assert.equal(sfxFor({ type: 'attack' }), 'attack');
  assert.equal(sfxFor({ type: 'impact' }), 'impact');
  assert.equal(sfxFor({ type: 'destroy' }), 'destroy');
  assert.equal(sfxFor({ type: 'victory' }), 'victory');
});

test('unknown events produce no sound', () => {
  assert.equal(sfxFor({ type: 'nope' }), null);
  assert.equal(sfxFor(undefined), null);
});
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `node --test tests/audio/sfx-events.test.js`
Expected: FAIL karena `sfxFor` belum ada.

- [ ] **Step 3: Tambahkan `SFX_EVENTS` dan `sfxFor` ke `src/audio/audio-system.js`**

Petakan `spawn`, `move`, `attack`, `impact`, `destroy`, `victory` ke efek suara, dan kembalikan `null` untuk tipe yang tidak dikenal serta untuk input kosong.

- [ ] **Step 4: Perbarui `src/scene/sand-effects.js`**

Tambahkan efek yang dibutuhkan: kemunculan pasir saat unit muncul, jejak kaki saat berjalan, kilatan saat menembak, hantaman saat terkena, dan keruntuhan menjadi pasir saat hancur.

- [ ] **Step 5: Jalankan tes**

Run: `node --test tests/audio/sfx-events.test.js` dan `npm test`
Expected: PASS.

---

## Task 10: Verifikasi akhir dan dokumentasi

**Files:**
- Create: `README.md`
- Modify: `docs/superpowers/specs/2026-09-11-webcam-marker-ar-design.md`

- [ ] **Step 1: Jalankan seluruh tes**

Run: `npm test`
Expected: PASS seluruh tes.

- [ ] **Step 2: Jalankan build**

Run: `npm run build`
Expected: sukses, dan folder `public/cards/` tersalin ke keluaran.

- [ ] **Step 3: Verifikasi aturan dependensi**

Run: `rg "from 'three'" src/core` dan `rg "\.\./" src/core`
Expected: tidak ada keluaran.

- [ ] **Step 4: Verifikasi berkas lama sudah tidak ada**

Pastikan `src/ar/ar-markerless.js` dan `src/ui/components/summon-zone.js` sudah tidak ada.

- [ ] **Step 5: Tulis `README.md`**

Jelaskan cara menjalankan `npm run dev`, cara mencetak kartu, cara mengompilasi berkas target, persyaratan pencahayaan dan jarak webcam, serta daftar peran dan statistik unit.

- [ ] **Step 6: Tandai status implementasi di spec**

Perbarui baris status di berkas spec menjadi "diimplementasikan" dan tambahkan catatan hasil verifikasi.

---

## Catatan Verifikasi Manual

Langkah berikut memerlukan webcam dan kartu cetak, jadi tidak dapat diotomatiskan:

- Cetak `public/cards/lembar-a4.svg` pada kertas A4.
- Jalankan `npm run dev`, buka di Chrome, izinkan kamera.
- Letakkan tiga kartu di kiri dan tiga di kanan, urutan bebas.
- Pastikan aplikasi melaporkan keenam kartu terdeteksi dan komposisi tim valid.
- Pastikan model muncul menempel pada kartu, lalu berjalan keluar ke arena.
- Pastikan artileri berhenti di jarak tembak dan prajurit maju sampai menempel.
- Pastikan HP bar berubah saat unit terkena serangan.
- Pastikan battle berakhir saat salah satu base hancur.
- Periksa perilaku saat pencahayaan kurang dan saat satu kartu tertutup.
