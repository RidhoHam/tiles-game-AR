# Redesign AR Sand War Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rapikan proyek menjadi bundle Vite vanilla JS dengan struktur modular berlapis, wizard bertahap, HUD minimal AR, dan satu roster unit terpadu.

**Architecture:** Dependensi satu arah `core → scene → ar/audio/ui → app`. `core/` adalah domain murni tanpa Three.js atau DOM. `scene/` merender dan mengelola lifecycle mesh/grain. `ar/`, `audio/`, `ui/` mengonsumsi layer di bawahnya. `app/` menjadi satu-satunya tempat penyusunan dependency.

**Tech Stack:** Vite 7, vanilla JavaScript (ESM), Three.js 0.180, `@strudel/web` 1.3, Node test runner.

## Global Constraints

- Tidak menambah framework UI. DOM dibuat manual dengan `document.createElement`.
- `core/` tidak boleh mengimpor `three`, `@strudel/web`, atau modul `src/` lain.
- Tidak ada `display` CSS yang menimpa atribut `hidden`; visibilitas memakai satu mekanisme.
- Tidak ada dua sesi kamera bersamaan antara WebXR immersive dan marker tracking.
- Stat unit: castle 200 HP, bunker 200 HP, robot 120 HP/16 dmg/1.6s, tank 100 HP/20 dmg/2.0s, knight 70 HP/14 dmg/1.3s, gargoyle 60 HP/12 dmg/1.1s. Cooldown summon 8 detik.
- Roster awal wajib satu base dan satu war-machine per tim; reinforcement maksimal satu knight dan satu gargoyle aktif per tim.
- Item yang sudah ada dan harus dipertahankan: `core/battle-system.js`, `scene/sand-grains.js`, tes grain, dan perilaku build/destroy struktur.
- Folder proyek tidak memiliki Git. Jangan membuat commit; verifikasi lewat `npm test` dan `npm run build`.

---
## Task 1: Buat tulang struktur folder dan pindahkan domain ke `core/`

**Files:**
- Create: `src/core/unit-definitions.js`
- Create: `src/core/roster.js`
- Create: `src/core/rng.js`
- Create: `src/core/battle-system.js`
- Create: `tests/core/battle-system.test.js`
- Delete: `battle-system.js`
- Delete: `tests/battle-system.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `UNIT_DEFINITIONS` (object keyed by type), `FACTIONS = ['blue','red']`, `REINFORCEMENT_TYPES = ['knight','gargoyle']`, `validateFormation(slots) -> { valid, errors, byFaction }`, `formationSeed(slots) -> string`, `class BattleSystem` dengan `configure(slots)`, `start()`, `update(dt)`, `summon(faction, type)`, `damage(unitId, amount, reason)`, `snapshot()`, `reset()`.
- Produces: `createRng(seed) -> () => number` dengan `next()`, `pick(array)`, `range(min, max)`.

- [ ] **Step 1: Tulis tes roster yang gagal**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFormation, formationSeed } from '../../src/core/roster.js';

const valid = [
  { faction: 'blue', type: 'castle' }, { faction: 'blue', type: 'tank' },
  { faction: 'red', type: 'bunker' }, { faction: 'red', type: 'robot' }
];

test('roster requires one base and one war machine per team', () => {
  assert.equal(validateFormation(valid).valid, true);
  assert.equal(validateFormation([{ faction: 'blue', type: 'castle' }, { faction: 'blue', type: 'bunker' }]).valid, false);
});

test('roster rejects reinforcement types in initial slots', () => {
  const result = validateFormation([{ faction: 'blue', type: 'knight' }, { faction: 'blue', type: 'tank' }]);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /Kesatria dan Gargoyle/);
});

test('formation seed is stable regardless of slot order', () => {
  assert.equal(formationSeed(valid), formationSeed([...valid].reverse()));
});
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `node --test tests/core/battle-system.test.js`
Expected: FAIL karena `src/core/roster.js` belum ada.

- [ ] **Step 3: Tulis `src/core/unit-definitions.js`**

```js
export const FACTIONS = Object.freeze(['blue', 'red']);
export const REINFORCEMENT_TYPES = Object.freeze(['knight', 'gargoyle']);

export const UNIT_DEFINITIONS = Object.freeze({
  castle: { role: 'base', title: 'Benteng Pasir', maxHealth: 200, damage: 0, cooldown: Infinity },
  bunker: { role: 'base', title: 'Bunker Berduri', maxHealth: 200, damage: 0, cooldown: Infinity },
  robot: { role: 'war-machine', title: 'Robot Pasir', maxHealth: 120, damage: 16, cooldown: 1.6 },
  tank: { role: 'war-machine', title: 'Tank Pasir', maxHealth: 100, damage: 20, cooldown: 2 },
  knight: { role: 'reinforcement', title: 'Kesatria Pasir', maxHealth: 70, damage: 14, cooldown: 1.3 },
  gargoyle: { role: 'reinforcement', title: 'Gargoyle Pasir', maxHealth: 60, damage: 12, cooldown: 1.1 }
});

export const INITIAL_TYPES = Object.freeze(['castle', 'bunker', 'robot', 'tank']);
```

- [ ] **Step 4: Tulis `src/core/roster.js`**

```js
import { FACTIONS, UNIT_DEFINITIONS, REINFORCEMENT_TYPES } from './unit-definitions.js';

export function validateFormation(slots) {
  const errors = [];
  const byFaction = Object.fromEntries(FACTIONS.map(faction => [faction, []]));
  for (const slot of slots || []) {
    if (!slot || !FACTIONS.includes(slot.faction) || !UNIT_DEFINITIONS[slot.type]) {
      errors.push('Slot unit tidak valid.');
      continue;
    }
    if (UNIT_DEFINITIONS[slot.type].role === 'reinforcement') {
      errors.push('Kesatria dan Gargoyle hanya dipanggil saat battle.');
      continue;
    }
    byFaction[slot.faction].push(slot.type);
  }
  for (const faction of FACTIONS) {
    const types = byFaction[faction];
    if (types.length !== 2) errors.push(`Tim ${faction} membutuhkan dua unit awal.`);
    const roles = types.map(type => UNIT_DEFINITIONS[type].role);
    const bases = roles.filter(role => role === 'base').length;
    const machines = roles.filter(role => role === 'war-machine').length;
    if (bases !== 1 || machines !== 1) errors.push(`Tim ${faction} membutuhkan satu Base dan satu War Machine.`);
  }
  return { valid: errors.length === 0, errors, byFaction };
}

export function formationSeed(slots) {
  return (slots || []).map(slot => `${slot.faction}:${slot.type}:${slot.slot || ''}`).sort().join('|');
}
```

- [ ] **Step 5: Tulis `src/core/rng.js`**

```js
export function createRng(seed) {
  let state = 0;
  const text = String(seed ?? '');
  for (let i = 0; i < text.length; i++) state = (Math.imul(state, 31) + text.charCodeAt(i)) >>> 0;
  state = (state + 2166136261) >>> 0;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  return {
    next,
    pick: array => (array.length ? array[Math.floor(next() * array.length)] : undefined),
    range: (min, max) => min + next() * (max - min)
  };
}
```

- [ ] **Step 6: Tulis `src/core/battle-system.js`**

Pindahkan isi `battle-system.js` saat ini, lalu ubah agar mengimpor dari `./unit-definitions.js` dan `./roster.js` alih-alih mendefinisikan `UNIT_DEFINITIONS`, `FACTIONS`, `REINFORCEMENT_TYPES`, `validateFormation`, dan `formationSeed` secara lokal. Ekspor ulang yang diperlukan:

```js
export { UNIT_DEFINITIONS, FACTIONS, REINFORCEMENT_TYPES } from './unit-definitions.js';
export { validateFormation, formationSeed } from './roster.js';
export class BattleSystem { /* pindahkan implementasi yang sudah ada tanpa mengubah perilaku */ }
```

- [ ] **Step 7: Pindahkan tes battle lama**

Pindahkan `tests/battle-system.test.js` ke `tests/core/battle-system.test.js` dengan import diubah dari `'../battle-system.js'` menjadi `'../../src/core/battle-system.js'`, lalu gabungkan tiga tes roster dari Step 1 ke berkas yang sama.

- [ ] **Step 8: Perbarui `package.json`**

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "test": "node --test tests/*.test.js tests/**/*.test.js"
}
```

- [ ] **Step 9: Hapus berkas lama**

Hapus `battle-system.js` dan `tests/battle-system.test.js` setelah isinya dipindahkan.

- [ ] **Step 10: Jalankan tes**

Run: `npm test`
Expected: PASS untuk tes core baru dan tes grain yang sudah ada. Tes `main.js` belum ada, jadi hanya tes domain yang berjalan.

---
## Task 2: Pindahkan scene ke `scene/` dan pisahkan efek

**Files:**
- Create: `src/scene/sand-effects.js`
- Create: `src/scene/sand-structures.js`
- Create: `src/scene/sand-grains.js`
- Create: `src/scene/scene-system.js`
- Create: `tests/scene/sand-grains.test.js`
- Delete: `sand-grains.js`, `sand-structures.js`, `tests/sand-grains.test.js`

**Interfaces:**
- Consumes: tidak ada dari Task 1 selain struktur folder.
- Produces: `SandGrainSystem`, `createGrainSampler`, `createGrainPool` dari `scene/sand-grains.js`.
- Produces: `SandEffects` dari `scene/sand-effects.js` dengan `burst(position, count, construction)`, `update(dt)`, `dispose()`.
- Produces: `SandStructureSystem` dari `scene/sand-structures.js` dengan `create(type, position)`, `update(dt)`, `dispose()`, `fire(owner, muzzle, delay)`, properti `structures`, `projectiles`, `effects`, `grains`.

- [ ] **Step 1: Ekstrak `SandEffects` ke `src/scene/sand-effects.js`**

Pindahkan kelas `SandEffects` dari `sand-structures.js` ke berkas baru sebagai ekspor bernama. Constructor tetap `(scene, material, capacity)`.

- [ ] **Step 2: Pindahkan `sand-grains.js` ke `src/scene/sand-grains.js`**

Pindahkan berkas apa adanya; hanya import `three` yang tetap. Tidak ada perubahan isi.

- [ ] **Step 3: Pindahkan `sand-structures.js` ke `src/scene/sand-structures.js`**

Pindahkan berkas, lalu ubah:
- Hapus definisi `SandEffects` lokal, ganti dengan `import { SandEffects } from './sand-effects.js';`
- Ganti `import { SandGrainSystem } from './sand-grains.js';` menjadi jalur relatif yang benar bila perlu (tetap `./sand-grains.js`).

- [ ] **Step 4: Buat `src/scene/scene-system.js`**

```js
import * as THREE from 'three';
import { SandStructureSystem } from './sand-structures.js';

export function createSceneSystem(canvas, options = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.xr.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x68bed1);
  scene.fog = new THREE.Fog(0x8bc9d3, 30, 85);

  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.08, 140);
  camera.position.set(16, 18, 22);
  camera.lookAt(0, 1, 0);

  scene.add(new THREE.HemisphereLight(0xbcebf1, 0x8d673d, 1.65));
  const sun = new THREE.DirectionalLight(0xffedca, 2.1);
  sun.position.set(14, 22, 11);
  sun.castShadow = true;
  scene.add(sun);

  const root = new THREE.Group();
  scene.add(root);

  const systems = new SandStructureSystem(root, {
    particleCapacity: options.particleCapacity ?? 450,
    grainCapacity: options.grainCapacity ?? 40000
  });

  return { renderer, scene, camera, root, systems };
}
```

- [ ] **Step 5: Pindahkan tes grain**

Pindahkan `tests/sand-grains.test.js` ke `tests/scene/sand-grains.test.js` dan ubah import dari `'../sand-grains.js'` dan `'../sand-structures.js'` menjadi `'../../src/scene/sand-grains.js'` dan `'../../src/scene/sand-structures.js'`.

- [ ] **Step 6: Hapus berkas lama**

Hapus `sand-grains.js`, `sand-structures.js`, dan `tests/sand-grains.test.js`.

- [ ] **Step 7: Jalankan tes**

Run: `npm test`
Expected: PASS. Tes grain dan tes struktur berjalan dari lokasi baru.

---
## Task 3: Ubah `sand-units` menjadi model library di `scene/units/`

**Files:**
- Create: `src/scene/units/base-unit.js`
- Create: `src/scene/units/knight-unit.js`
- Create: `src/scene/units/gargoyle-unit.js`
- Create: `src/scene/units/unit-factory.js`
- Create: `tests/scene/units.test.js`
- Delete: `sand-units.js`, `tests/sand-units.test.js`, `tests/sand-weapons.test.js`

**Interfaces:**
- Consumes: `UNIT_DEFINITIONS` dari `../../core/unit-definitions.js`.
- Produces: `class SandUnit` dengan `(context, role, options)` dan properti `group`, `parts`, `health`, `maxHealth`, `state`, serta metode `build()`, `damage(amount)`, `collapse()`, `update(dt)`, `getMeshes()`, `dispose()`.
- Produces: `createUnit(type, context, options) -> SandUnit` yang memetakan `knight -> KnightUnit`, `gargoyle -> GargoyleUnit`, dan tipe lain ke `BaseUnit` bila diperlukan.
- `context` berisi `{ system, material, dark, primary }`; `options` berisi `{ position, faction, index }`.

- [ ] **Step 1: Tulis tes model library yang gagal**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { SandStructureSystem } from '../../src/scene/sand-structures.js';
import { createUnit } from '../../src/scene/units/unit-factory.js';

const context = () => {
  const root = new T.Group();
  const system = new SandStructureSystem(root, { grainCapacity: 4000, particleCapacity: 10 });
  return { system, material: system.material, dark: system.dark, primary: system.material, root };
};

test('knight unit takes stats from unit definitions', () => {
  const ctx = context();
  try {
    const unit = createUnit('knight', ctx, { position: new T.Vector3(), faction: 'blue', index: 0 });
    assert.equal(unit.maxHealth, 70);
    assert.equal(unit.state, 'hidden');
    assert.ok(unit.parts.length > 0);
    unit.dispose();
  } finally { ctx.system.dispose(); }
});

test('gargoyle unit exposes wings and collapses independently', () => {
  const ctx = context();
  try {
    const unit = createUnit('gargoyle', ctx, { position: new T.Vector3(), faction: 'red', index: 0 });
    assert.equal(unit.maxHealth, 60);
    assert.equal(unit.wings.length, 2);
    assert.equal(unit.collapse(), true);
    assert.equal(unit.collapse(), false);
    unit.dispose();
  } finally { ctx.system.dispose(); }
});

test('unit rejects unknown type', () => {
  const ctx = context();
  try { assert.throws(() => createUnit('dragon', ctx, {})); }
  finally { ctx.system.dispose(); }
});
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `node --test tests/scene/units.test.js`
Expected: FAIL karena `src/scene/units/unit-factory.js` belum ada.

- [ ] **Step 3: Buat `src/scene/units/base-unit.js`**

Pindahkan kelas `SandUnit` dari `sand-units.js` dengan perubahan:
- Constructor menjadi `(context, role, options = {})`.
- `this.system = context.system`, `this.material = context.material`, `this.dark = context.dark`, `this.primary = context.primary`.
- Hapus ketergantungan pada `spawner.structure`. Group ditambahkan ke `options.parent || context.root`.
- Health diambil dari `UNIT_DEFINITIONS[role].maxHealth` bila tipe dikenal; kalau tidak, tetap 100.
- `options.position`, `options.faction`, dan `options.index` menggantikan `formationOffset` dari spawner. Simpan `this.faction`.
- `build()` menetapkan `this.group.position.copy(this.materializeOffset)` di mana `materializeOffset = options.position.clone().add(new T.Vector3(0, 0, 2.1))`.
- `update(dt, context)` menerima `{ formationRadius }`, sama seperti sekarang.

- [ ] **Step 4: Buat `src/scene/units/knight-unit.js`**

Pindahkan `KnightUnit` dan `CaptainUnit` dari `sand-units.js`. Ganti referensi `this.spawner.material` menjadi `this.material`, `this.spawner.dark` menjadi `this.dark`, dan `this.spawner.armor` menjadi `this.primary`. `CaptainUnit` tetap sebagai subkelas dengan role `captain` dan health 150.

- [ ] **Step 5: Buat `src/scene/units/gargoyle-unit.js`**

Pindahkan `GargoyleUnit` dari `sand-units.js` dengan penggantian referensi yang sama. Health tetap 80.

- [ ] **Step 6: Buat `src/scene/units/unit-factory.js`**

```js
import { UNIT_DEFINITIONS } from '../../core/unit-definitions.js';
import { BaseUnit } from './base-unit.js';
import { KnightUnit } from './knight-unit.js';
import { GargoyleUnit } from './gargoyle-unit.js';

export function createUnit(type, context, options = {}) {
  if (type === 'knight') return new KnightUnit(context, 'knight', options);
  if (type === 'gargoyle') return new GargoyleUnit(context, options.index ?? 0, options);
  if (UNIT_DEFINITIONS[type]) return new BaseUnit(context, type, options);
  throw new Error(`Unknown unit type: ${type}`);
}
```

Sesuaikan signature `GargoyleUnit` agar menerima `(context, index, options)`.

- [ ] **Step 7: Hapus pasukan bawaan dari struktur**

Di `src/scene/sand-structures.js`, hapus `import` `SandUnitSpawner`, hapus pemanggilan `SandUnitSpawner.createCastle` dan `createBunker` di `finish()`, serta hapus pemakaian `this.units` di `update()`, `dispose()`, dan metode `spawnUnits`/`attackUnits`/`damageUnit`/`collapseUnits`. Perbarui `tests/scene/sand-grains.test.js` bila ia menyentuh `structure.units`.

- [ ] **Step 8: Hapus berkas lama**

Hapus `sand-units.js`, `tests/sand-units.test.js`, dan `tests/sand-weapons.test.js`.

- [ ] **Step 9: Jalankan tes**

Run: `npm test`
Expected: PASS untuk tes unit baru, grain, dan lifecycle struktur. Jumlah tes berkurang karena tes pasukan bawaan lama digantikan tes model library.

---
## Task 4: Pisahkan AR dan capabilities

**Files:**
- Create: `src/ar/capabilities.js`
- Create: `src/ar/ar-markerless.js`
- Create: `src/ar/ar-marker.js`
- Create: `tests/ar/capabilities.test.js`
- Delete: `ar-placement.js`, `marker-ar-controller.js`

**Interfaces:**
- Produces: `detectCapabilities(xr = navigator.xr) -> Promise<{ markerless, marker, secureContext, reasons }>`.
- Produces: `class ARMarkerlessController` dengan `(renderer, scene, root, options)`, metode `isSupported()`, `start()`, `update(frame)`, `place()`, `end()`, `dispose()`, dan properti `placed`.
- Produces: `class ARMarkerController` dengan `(options)`, metode `isSupported()`, `start()`, `stop()`, `reportDetection(type, pose)`, `reportLost(type)`.

- [ ] **Step 1: Tulis tes capabilities yang gagal**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCapabilities } from '../../src/ar/capabilities.js';

test('reports markerless unavailable when immersive-ar is unsupported', async () => {
  const xr = { isSessionSupported: async mode => mode !== 'immersive-ar' };
  const result = await detectCapabilities(xr);
  assert.equal(result.markerless, false);
  assert.match(result.reasons.join(' '), /immersive-ar/);
});

test('reports markerless available when immersive-ar is supported', async () => {
  const xr = { isSessionSupported: async () => true };
  const result = await detectCapabilities(xr);
  assert.equal(result.markerless, true);
});

test('marker mode requires camera support', async () => {
  const result = await detectCapabilities(undefined, { mediaDevices: undefined });
  assert.equal(result.marker, false);
});
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `node --test tests/ar/capabilities.test.js`
Expected: FAIL karena modul belum ada.

- [ ] **Step 3: Tulis `src/ar/capabilities.js`**

```js
export async function detectCapabilities(xr = typeof navigator !== 'undefined' ? navigator.xr : undefined, media = typeof navigator !== 'undefined' ? navigator : undefined) {
  const reasons = [];
  const secureContext = typeof window !== 'undefined' ? window.isSecureContext : false;
  const hasCamera = Boolean(media?.mediaDevices?.getUserMedia);
  if (!hasCamera) reasons.push('Kamera tidak tersedia di browser ini.');
  let immersiveAr = false;
  if (!xr?.isSessionSupported) reasons.push('WebXR tidak tersedia di browser ini.');
  else {
    try { immersiveAr = await xr.isSessionSupported('immersive-ar'); }
    catch { immersiveAr = false; }
    if (!immersiveAr) reasons.push('Perangkat tidak mendukung immersive-ar.');
  }
  if (!secureContext) reasons.push('Dibutuhkan HTTPS atau localhost.');
  return {
    markerless: Boolean(immersiveAr && hasCamera && secureContext),
    marker: Boolean(hasCamera && secureContext),
    secureContext,
    reasons
  };
}
```

- [ ] **Step 4: Pindahkan `ar-placement.js` ke `src/ar/ar-markerless.js`**

Rename kelas menjadi `ARMarkerlessController`. Tambahkan metode `isSupported()` yang mengecek `navigator.xr?.isSessionSupported('immersive-ar')`. Perubahan perilaku lain tidak diperlukan.

- [ ] **Step 5: Pindahkan `marker-ar-controller.js` ke `src/ar/ar-marker.js`**

Rename kelas menjadi `ARMarkerController`. Ganti `detect`/`lose` menjadi `reportDetection(type, pose)` dan `reportLost(type)`. Tambahkan `isSupported()` yang mengembalikan `Boolean(navigator?.mediaDevices?.getUserMedia)`.

- [ ] **Step 6: Hapus berkas lama, jalankan tes**

Hapus `ar-placement.js` dan `marker-ar-controller.js`.
Run: `npm test`
Expected: PASS termasuk tes capabilities baru.

---

## Task 5: Pindahkan audio dan tambahkan kontrol

**Files:**
- Create: `src/audio/audio-system.js`
- Create: `tests/audio/audio-system.test.js`
- Delete: `audio-system.js`

**Interfaces:**
- Produces: `class AudioSystem` dengan `unlock()`, `setMuted(bool)`, `setMusicVolume(number)`, `setSfxVolume(number)`, `playPhase(phase)`, `handleEvent(event)`, `dispose()`, dan properti `ready`, `muted`, `musicVolume`, `sfxVolume`, `phase`.
- `playPhase` menerima `'setup' | 'battle' | 'result'`.

- [ ] **Step 1: Tulis tes audio yang gagal**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioSystem } from '../../src/audio/audio-system.js';

test('audio stays inert until a global pattern engine exists', () => {
  const audio = new AudioSystem();
  assert.equal(audio.ready, false);
  assert.doesNotThrow(() => audio.playPhase('battle'));
  assert.doesNotThrow(() => audio.handleEvent({ type: 'impact' }));
  assert.equal(audio.muted, false);
});

test('volume is clamped and mute state is tracked', () => {
  const audio = new AudioSystem();
  audio.setMusicVolume(5);
  audio.setSfxVolume(-3);
  assert.equal(audio.musicVolume, 1);
  assert.equal(audio.sfxVolume, 0);
  audio.setMuted(true);
  assert.equal(audio.muted, true);
});
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `node --test tests/audio/audio-system.test.js`
Expected: FAIL karena modul belum ada.

- [ ] **Step 3: Tulis `src/audio/audio-system.js`**

Pindahkan `audio-system.js` saat ini. Perubahan:
- Tambahkan `phase === 'result'` dengan pola ringkas.
- Ganti `event(event)` menjadi `handleEvent(event)`.
- Semua akses ke fungsi global Strudel dilakukan lewat helper yang aman:

```js
function pattern(name, ...args) {
  const fn = globalThis[name];
  if (typeof fn !== 'function') return null;
  try { return fn(...args); } catch { return null; }
}
```

Semua pemanggilan `globalThis.note`, `globalThis.sound`, dan `globalThis.hush` diganti memakai helper ini sehingga modul aman diuji di Node.

- [ ] **Step 4: Jalankan tes, hapus berkas lama**

Run: `node --test tests/audio/audio-system.test.js`
Expected: PASS.
Hapus `audio-system.js`.

---
## Task 6: State machine fase dan kerangka UI

**Files:**
- Create: `src/ui/app-state.js`
- Create: `src/ui/components/toast.js`
- Create: `tests/ui/app-state.test.js`

**Interfaces:**
- Produces: `PHASES = ['mode','placement','roster','build','battle','result']`.
- Produces: `createAppState({ onChange } = {})` dengan properti `phase`, `mode`, `roster`, `formation`, `capabilities`, `winner`, dan metode `canGoTo(phase)`, `goTo(phase)`, `next()`, `back()`, `setRoster(slots)`, `subscribe(listener)`, `snapshot()`.
- Produces: `createToast(rootElement) -> { show(message, options), dispose() }`.

- [ ] **Step 1: Tulis tes state machine yang gagal**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppState, PHASES } from '../../src/ui/app-state.js';

test('phase order is fixed and starts at mode', () => {
  assert.deepEqual(PHASES, ['mode', 'placement', 'roster', 'build', 'battle', 'result']);
  assert.equal(createAppState().phase, 'mode');
});

test('mode selection advances to placement for markerless', () => {
  const state = createAppState();
  state.goTo('mode');
  state.setMode('markerless');
  assert.equal(state.next(), 'placement');
});

test('preview mode skips placement', () => {
  const state = createAppState();
  state.setMode('preview');
  assert.equal(state.next(), 'roster');
});

test('invalid transitions are rejected without changing phase', () => {
  const state = createAppState();
  assert.equal(state.goTo('battle'), false);
  assert.equal(state.phase, 'mode');
});

test('back from roster returns to placement for markerless only', () => {
  const state = createAppState();
  state.setMode('markerless');
  state.goTo('roster');
  assert.equal(state.back(), 'placement');
  state.setMode('preview');
  assert.equal(state.back(), 'mode');
});

test('listeners receive every change', () => {
  const seen = [];
  const state = createAppState({ onChange: snapshot => seen.push(snapshot.phase) });
  state.setMode('preview');
  state.next();
  assert.deepEqual(seen, ['mode', 'roster']);
});
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `node --test tests/ui/app-state.test.js`
Expected: FAIL karena modul belum ada.

- [ ] **Step 3: Tulis `src/ui/app-state.js`**

```js
export const PHASES = Object.freeze(['mode', 'placement', 'roster', 'build', 'battle', 'result']);

export function createAppState({ onChange } = {}) {
  let state = {
    phase: 'mode',
    mode: null,
    roster: null,
    formation: null,
    capabilities: null,
    winner: null
  };
  const listeners = new Set();
  if (onChange) listeners.add(onChange);

  const allowed = (from, to) => {
    if (from === to) return false;
    if (from === 'mode') return to === 'placement' || to === 'roster';
    if (from === 'placement') return to === 'roster' || to === 'mode';
    if (from === 'roster') return to === 'build' || to === 'placement' || to === 'mode';
    if (from === 'build') return to === 'battle' || to === 'roster';
    if (from === 'battle') return to === 'result' || to === 'roster';
    if (from === 'result') return to === 'battle' || to === 'roster' || to === 'mode';
    return false;
  };

  const commit = () => { const snap = snapshot(); listeners.forEach(listener => listener(snap)); };

  function snapshot() { return { ...state }; }

  return {
    get phase() { return state.phase; },
    get mode() { return state.mode; },
    get roster() { return state.roster; },
    get winner() { return state.winner; },
    setMode(mode) { state.mode = mode; commit(); },
    setCapabilities(capabilities) { state.capabilities = capabilities; },
    setRoster(slots) { state.roster = slots; commit(); },
    setWinner(winner) { state.winner = winner; commit(); },
    canGoTo(phase) { return PHASES.includes(phase) && allowed(state.phase, phase); },
    goTo(phase) { if (!this.canGoTo(phase)) return false; state.phase = phase; commit(); return true; },
    next() {
      if (state.phase === 'mode') return this.goTo(state.mode === 'preview' ? 'roster' : 'placement') ? state.phase : state.phase;
      if (state.phase === 'placement') return this.goTo('roster') ? state.phase : state.phase;
      if (state.phase === 'roster') return this.goTo('build') ? state.phase : state.phase;
      if (state.phase === 'build') return this.goTo('battle') ? state.phase : state.phase;
      if (state.phase === 'battle') return this.goTo('result') ? state.phase : state.phase;
      return state.phase;
    },
    back() {
      if (state.phase === 'placement') return this.goTo('mode') ? state.phase : state.phase;
      if (state.phase === 'roster') return this.goTo(state.mode === 'markerless' ? 'placement' : 'mode') ? state.phase : state.phase;
      if (state.phase === 'build') return this.goTo('roster') ? state.phase : state.phase;
      if (state.phase === 'battle') return this.goTo('roster') ? state.phase : state.phase;
      if (state.phase === 'result') return this.goTo('roster') ? state.phase : state.phase;
      return state.phase;
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    snapshot
  };
}
```

- [ ] **Step 4: Tulis `src/ui/components/toast.js`**

```js
export function createToast(root) {
  const element = document.createElement('div');
  element.className = 'toast';
  element.setAttribute('role', 'status');
  root.append(element);
  let timer = null;
  return {
    show(message, { duration = 3200 } = {}) {
      element.textContent = message;
      element.classList.add('is-visible');
      clearTimeout(timer);
      timer = setTimeout(() => element.classList.remove('is-visible'), duration);
    },
    dispose() { clearTimeout(timer); element.remove(); }
  };
}
```

- [ ] **Step 5: Jalankan tes**

Run: `npm test`
Expected: PASS termasuk enam tes state machine.

---
## Task 7: Komponen HUD AR

**Files:**
- Create: `src/ui/components/status-pill.js`
- Create: `src/ui/components/quick-menu.js`
- Create: `src/ui/components/unit-label.js`
- Create: `src/ui/components/summon-zone.js`
- Create: `tests/ui/components.test.js`

**Interfaces:**
- Consumes: `BattleSystem` snapshot dari `core/battle-system.js`.
- Produces: `createStatusPill(root) -> { update(snapshot), dispose() }` yang menampilkan `MM:SS · Biru <hp> / Merah <hp>` dan membuka detail sekilas saat diketuk.
- Produces: `createQuickMenu(root, actions) -> { open(), close(), isOpen, dispose() }` dengan `actions = { replay, changeRoster, toggleMute }`.
- Produces: `createUnitLabel(root) -> { show(unit, targetTitle, position), hide(), dispose() }`.
- Produces: `createSummonZones(root, options) -> { update(battle), dispose() }` yang membuat empat zona (dua per tim) dan melaporkan pilihan lewat `options.onSummon(faction, type)`, menonaktifkan tombol saat cooldown, dan menampilkan sisa detik.

- [ ] **Step 1: Tulis tes komponen yang gagal**

Tes berjalan di Node tanpa DOM, jadi gunakan elemen tiruan minimal.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStatusPillLabel } from '../../src/ui/components/status-pill.js';
import { formatCooldown } from '../../src/ui/components/summon-zone.js';

test('status pill formats time and health', () => {
  assert.equal(createStatusPillLabel({ time: 84, units: [] }, { blue: 168, red: 162 }), '01:24 · Biru 168 / Merah 162');
});

test('cooldown formats remaining seconds', () => {
  assert.equal(formatCooldown(0), '');
  assert.equal(formatCooldown(7.2), '8s');
  assert.equal(formatCooldown(1), '1s');
});
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `node --test tests/ui/components.test.js`
Expected: FAIL karena modul belum ada.

- [ ] **Step 3: Tulis `src/ui/components/status-pill.js`**

```js
export function createStatusPillLabel(snapshot, baseHealth) {
  const total = Math.max(0, Math.floor(snapshot.time || 0));
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds} · Biru ${baseHealth.blue} / Merah ${baseHealth.red}`;
}

export function createStatusPill(root) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'status-pill';
  button.setAttribute('aria-live', 'polite');
  const detail = document.createElement('div');
  detail.className = 'status-pill__detail';
  detail.hidden = true;
  root.append(button, detail);
  let expanded = false;
  button.addEventListener('click', () => { expanded = !expanded; detail.hidden = !expanded; });
  return {
    update(snapshot, baseHealth) {
      button.textContent = createStatusPillLabel(snapshot, baseHealth);
      const running = snapshot.units.filter(unit => unit.alive);
      detail.replaceChildren(...running.map(unit => {
        const row = document.createElement('p');
        row.textContent = `${unit.type} · ${unit.health}/${unit.maxHealth}`;
        return row;
      }));
    },
    dispose() { button.remove(); detail.remove(); }
  };
}
```

- [ ] **Step 4: Tulis `src/ui/components/summon-zone.js`**

Ekspor `formatCooldown(remaining)` yang mengembalikan `''` saat `remaining <= 0`, dan `${Math.ceil(remaining)}s` saat lebih besar. Ekspor `createSummonZones(root, { onSummon })` yang membuat empat tombol berkelas `summon-zone` dengan `data-faction` dan `data-type`, serta menyediakan `update(battleSnapshot)` untuk menetapkan `disabled` dan label sisa cooldown berdasarkan `slot.availableAt - snapshot.time`.

- [ ] **Step 5: Tulis `src/ui/components/quick-menu.js`**

Buat `createQuickMenu(root, actions)` dengan elemen `.quick-menu` berisi tiga tombol. `open()` menampilkan dan memanggil `close()` pada `actions.autoCloseMs ?? 6000` berikutnya. `close()` menyembunyikan. Ekspor `isOpen()`.

- [ ] **Step 6: Tulis `src/ui/components/unit-label.js`**

Buat `createUnitLabel(root)` yang membuat `.unit-label` dan menyediakan `show(unit, targetTitle, { x, y })`, `hide()`, `dispose()`. Format teks: `${title} · ${unit.health}/${unit.maxHealth}` dan baris kedua `Target: ${targetTitle ?? '—'}`.

- [ ] **Step 7: Jalankan tes**

Run: `node --test tests/ui/components.test.js`
Expected: PASS untuk dua tes format.

---
## Task 8: Layar wizard dan orkestrasi

**Files:**
- Create: `src/ui/screens/screen-mode.js`
- Create: `src/ui/screens/screen-placement.js`
- Create: `src/ui/screens/screen-roster.js`
- Create: `src/ui/screens/screen-build.js`
- Create: `src/ui/screens/screen-battle.js`
- Create: `src/ui/screens/screen-result.js`
- Create: `src/ui/wizard.js`
- Create: `src/app/game-controller.js`
- Create: `src/app/bootstrap.js`
- Delete: `main.js`

**Interfaces:**
- Consumes: `createAppState`, seluruh komponen Task 7, `BattleSystem`, `createSceneSystem`, `detectCapabilities`, `ARMarkerlessController`, `ARMarkerController`, `AudioSystem`.
- Produces: `mountWizard(root, state) -> { render(phase), dispose() }` yang merender satu layar sesuai fase aktif.
- Produces: `createGameController({ canvas, root }) -> { start(), dispose() }`.

- [ ] **Step 1: Tulis `src/ui/screens/screen-mode.js`**

Layar memilih salah satu dari tiga mode. Tombol `markerless` dan `marker` dinonaktifkan bila `state.capabilities` menyatakan tidak didukung, dengan alasan ditampilkan sebagai teks kecil. Tombol `preview` selalu aktif. Setiap tombol memanggil `onSelect(mode)`.

- [ ] **Step 2: Tulis `src/ui/screens/screen-placement.js`**

Menampilkan instruksi sesuai mode: markerless meminta mengarahkan kamera ke meja dan menekan "Letakkan Arena" (memanggil `onPlace()`); marker menampilkan progres `n/4 kartu terdeteksi` dari `onProgress`; preview langsung menampilkan tombol Lanjut.

- [ ] **Step 3: Tulis `src/ui/screens/screen-roster.js`**

Membuat empat slot berisi `<select>` dengan opsi dari `INITIAL_TYPES`. Setiap perubahan memanggil `onChange(slots)`. Menampilkan satu baris kesalahan dari `validateFormation`. Menyediakan kontrol audio: tombol mute dan dua `<input type="range">` untuk musik dan SFX yang memanggil `onAudio({ muted, music, sfx })`. Tombol Lanjut memanggil `onConfirm(slots)` dan hanya aktif ketika formasi valid.

- [ ] **Step 4: Tulis `src/ui/screens/screen-build.js`**

Menampilkan progress bar yang diisi dari `onProgress(ratio)` dan tombol "Mulai Battle" yang aktif setelah semua struktur mencapai state `built`.

- [ ] **Step 5: Tulis `src/ui/screens/screen-battle.js`**

Memasang `createStatusPill`, `createSummonZones`, dan `createQuickMenu`. Menyediakan `update(battleSnapshot)` yang memperbarui pill dan zona summon. Menyediakan `flashUnit(unit, targetTitle)` untuk menampilkan unit label. Klik ganda pada kanvas memanggil `actions.openMenu()`.

- [ ] **Step 6: Tulis `src/ui/screens/screen-result.js`**

Menampilkan `Tim Biru menang` atau `Tim Merah menang`, durasi battle, jumlah summon per tim, dan dua tombol: Ulangi (`onReplay`) dan Ganti Roster (`onChangeRoster`).

- [ ] **Step 7: Tulis `src/ui/wizard.js`**

```js
import { createScreenMode } from './screens/screen-mode.js';
import { createScreenPlacement } from './screens/screen-placement.js';
import { createScreenRoster } from './screens/screen-roster.js';
import { createScreenBuild } from './screens/screen-build.js';
import { createScreenBattle } from './screens/screen-battle.js';
import { createScreenResult } from './screens/screen-result.js';

const factories = {
  mode: createScreenMode,
  placement: createScreenPlacement,
  roster: createScreenRoster,
  build: createScreenBuild,
  battle: createScreenBattle,
  result: createScreenResult
};

export function mountWizard(root, state, handlers = {}) {
  const host = document.createElement('div');
  host.className = 'wizard';
  const progress = document.createElement('div');
  progress.className = 'wizard__progress';
  const outlet = document.createElement('div');
  outlet.className = 'wizard__outlet';
  host.append(progress, outlet);
  root.append(host);

  let current = null;
  let currentPhase = null;
  const render = phase => {
    if (current?.dispose) current.dispose();
    outlet.replaceChildren();
    current = factories[phase](outlet, state, handlers[phase] ?? {});
    currentPhase = phase;
    const index = ['mode', 'placement', 'roster', 'build', 'battle', 'result'].indexOf(phase);
    progress.style.setProperty('--progress', `${((index + 1) / 6) * 100}%`);
    progress.dataset.phase = phase;
  };
  const unsubscribe = state.subscribe(snapshot => { if (snapshot.phase !== currentPhase) render(snapshot.phase); });
  render(state.phase);
  return { render, dispose() { unsubscribe(); current?.dispose?.(); host.remove(); } };
}
```

- [ ] **Step 8: Tulis `src/app/game-controller.js`**

Controller menyusun semua dependency dan mendaftarkan handler per fase:

- `mode.onSelect(mode)` menyimpan mode ke state, memanggil `detectCapabilities`, lalu `state.next()`.
- `placement.onPlace()` memanggil `markerless.place()`; untuk marker, `onProgress` menerima `reportDetection` dari `ARMarkerController`.
- `roster.onConfirm(slots)` menyimpan roster, membuat instance struktur lewat `systems.create(type, position)` untuk empat slot, memanggil `build()`, dan berpindah ke fase `build`.
- `build.onProgress` dipanggil setiap frame dari animation loop sampai semua struktur `built`, lalu mengaktifkan tombol.
- `battle` memasang `BattleSystem`, meneruskan event ke `audio.handleEvent` dan ke efek scene. `onSummon(faction, type)` memanggil `battle.summon`, dan saat event `summon` diterima, `createUnit` membuat model di posisi reinforcement.
- `result` menerima `state.setWinner`.
- Handler audio memanggil `audio.setMuted`, `setMusicVolume`, dan `setSfxVolume`.

Animation loop memanggil `systems.update(dt)`, `battle.update(dt)`, `markerless.update(frame)`, dan `renderer.render(scene, camera)`.

- [ ] **Step 9: Tulis `src/app/bootstrap.js`**

```js
import '../styles/tokens.css';
import '../styles/app.css';
import { createGameController } from './game-controller.js';

const canvas = document.querySelector('#scene');
const uiRoot = document.querySelector('#ui');
const controller = createGameController({ canvas, root: uiRoot });
controller.start();
```

- [ ] **Step 10: Perbarui `index.html`**

```html
<!doctype html>
<html lang="id">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
    <meta name="theme-color" content="#55afc8" />
    <title>Perang Benteng Pasir AR</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700&family=Inter:wght@500;600;700&display=swap" rel="stylesheet" />
  </head>
  <body>
    <canvas id="scene" aria-label="Arena Perang Benteng Pasir AR"></canvas>
    <div id="ui"></div>
    <script type="module" src="/src/app/bootstrap.js"></script>
  </body>
</html>
```

- [ ] **Step 11: Hapus `main.js` dan jalankan build**

Run: `npm run build`
Expected: build sukses tanpa error import. Hapus `main.js` sebelum build.

---
## Task 9: Token gaya dan layout wizard

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/app.css`
- Delete: `style.css`

**Interfaces:**
- Consumes: kelas komponen dari Task 6 dan Task 7 (`.status-pill`, `.quick-menu`, `.unit-label`, `.summon-zone`, `.toast`, `.wizard`, `.wizard__progress`, `.wizard__outlet`, `.screen-mode`, `.screen-placement`, `.screen-roster`, `.screen-build`, `.screen-battle`, `.screen-result`).
- Produces: tidak ada ekspor JavaScript.

- [ ] **Step 1: Tulis `src/styles/tokens.css`**

```css
:root {
  --color-bg: #6ebed1;
  --color-sand: #e2c994;
  --color-sand-dark: #c7bc94;
  --color-ink: #31281e;
  --color-muted: #705c43;
  --color-accent: #238d88;
  --color-accent-ink: #16676c;
  --color-blue: #176db2;
  --color-red: #bd4b3c;
  --color-panel: #fff6e8e8;
  --color-panel-solid: #fff6e8;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 18px;
  --radius-pill: 999px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --shadow-panel: 0 12px 30px #67482026;
  --font-display: "Baloo 2", sans-serif;
  --font-body: Inter, sans-serif;
  --safe-bottom: max(var(--space-3), env(safe-area-inset-bottom));
}
[hidden] { display: none !important; }
```

- [ ] **Step 2: Tulis `src/styles/app.css`**

Aturan wajib:

```css
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
#scene { position: fixed; inset: 0; width: 100%; height: 100%; touch-action: none; }
#ui { position: fixed; inset: 0; pointer-events: none; }
#ui button, #ui input, #ui select, .wizard { pointer-events: auto; }
.wizard__progress { position: fixed; top: 0; left: 0; right: 0; height: 3px; background: transparent; }
.wizard__progress::after { content: ''; display: block; height: 100%; width: var(--progress, 0%); background: var(--color-accent); transition: width .3s ease; }
```

Tambahkan gaya untuk `.status-pill`, `.quick-menu`, `.unit-label`, `.summon-zone`, `.toast`, `.wizard__outlet`, dan keenam layar. Ketentuan:

- `.status-pill` adalah satu-satunya elemen HUD yang selalu terlihat saat battle: posisi atas tengah, `border-radius: var(--radius-pill)`, latar `var(--color-panel)`, ukuran font kecil.
- `.quick-menu` tersembunyi secara default dan hanya tampil saat `open()`.
- `.summon-zone` adalah tombol bulat kecil dengan indikator cincin cooldown memakai `conic-gradient` dari variabel `--cooldown`.
- `.wizard__outlet` menempatkan panel layar pada satu area: bawah di portrait, kiri di landscape lebar, selalu dengan `max-height` agar arena tetap terlihat.
- Tidak ada aturan yang menetapkan `display` untuk elemen yang memakai atribut `hidden` selain `[hidden] { display: none !important; }` di token.

- [ ] **Step 3: Hapus `style.css`**

- [ ] **Step 4: Verifikasi visual**

Run: `npm run dev`, buka di browser, dan periksa keenam fase: hanya satu layar tampil, progress bar berubah, tidak ada panel bertumpuk, dan HUD battle hanya menampilkan pill serta zona summon.

---

## Task 10: Verifikasi akhir

**Files:**
- Modify: `docs/superpowers/specs/2026-09-10-ar-redesign-design.md` (tambahkan catatan status implementasi bila perlu)

- [ ] **Step 1: Jalankan seluruh tes**

Run: `npm test`
Expected: PASS untuk semua tes core, scene, ar, audio, dan ui.

- [ ] **Step 2: Jalankan build produksi**

Run: `npm run build`
Expected: sukses. Bila bundel melewati 500 kB, catat ukurannya; audio boleh dipindah ke dynamic import setelah fase mode dipilih sebagai optimasi lanjutan, bukan syarat selesai.

- [ ] **Step 3: Periksa tidak ada berkas yatim**

Pastikan `main.js`, `style.css`, `sand-grains.js`, `sand-structures.js`, `sand-units.js`, `battle-system.js`, `audio-system.js`, `ar-placement.js`, dan `marker-ar-controller.js` sudah tidak ada di root proyek.

- [ ] **Step 4: Periksa aturan dependensi**

Pastikan tidak ada berkas di `src/core/` yang mengimpor `three` atau modul `src/` lain di luar `src/core/`.

Run: `rg "from 'three'" src/core` dan `rg "\.\./" src/core`
Expected: tidak ada keluaran.

---

## Catatan Verifikasi Manual

Karena sesi AR memerlukan perangkat dan HTTPS, langkah berikut dilakukan manual dan bukan syarat otomatis:

- Android Chrome HTTPS: mode markerless — izin kamera, reticle, penempatan arena, roster, build, battle, summon, result, ulangi.
- Android Chrome HTTPS: mode marker — izin kamera, progres kartu, dan perilaku saat tracking hilang.
- Preview desktop: seluruh wizard berjalan tanpa AR.
- Kamera ditolak, `immersive-ar` tidak didukung, audio diblokir, dan sesi AR berakhir di tengah battle.