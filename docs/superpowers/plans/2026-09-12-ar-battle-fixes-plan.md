# AR Battle Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make card guides, per-card 3D previews, battle targeting, and model scale behave correctly in the webcam AR experience.

**Architecture:** Keep MindAR as the pose source, keep preview models in the application Three.js scene, and keep battle decisions in the pure `src/core/` domain. Fix visual scale independently from simulation coordinates so models remain readable without changing attack distances.

**Tech Stack:** Vite, Three.js, MindAR 1.2.5, Node test runner, ES modules.

## Global Constraints

- The experience remains Chrome desktop webcam marker AR.
- Six cards remain the only lineup input: three blue and three red.
- Cards do not move during battle; units move on one shared arena plane.
- Base units do not attack; artillery uses long range; soldiers use close range.
- Preview models are created independently per detected card and disposed when detection disappears.
- `src/core/` must remain free of Three.js, DOM, and tracking imports.
- Run `npm test` and `npm run build` after implementation.

---

### Task 1: Correct Card Preview Scale And Pose

**Files:**
- Modify: `src/scene/card-previews.js`
- Test: `tests/scene/card-previews.test.js`

**Interfaces:**
- Consumes: `{ cardId, type, side, pose }` detections and existing `SandStructureSystem.create()`.
- Produces: one reusable preview model per detected card with a documented scale constant and marker-following transform.

- [ ] **Step 1: Add a failing scale test**

Extend the existing preview test to assert the selected preview scale is at least twice the current value while preserving the existing model-scale multiplier:

```js
assert.ok(PREVIEW_SCALE >= 0.16);
assert.equal(scale.x, PREVIEW_SCALE * 1.5);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/scene/card-previews.test.js`

Expected: FAIL because the current `PREVIEW_SCALE` is `0.08`.

- [ ] **Step 3: Implement the minimal scale change**

Change `PREVIEW_SCALE` to `0.18` as the initial 2x visual target. Keep the existing per-card map, immediate build, pose matrix composition, and disposal behavior unchanged. Update the nearby comment to describe the new target as approximately 1.5-2 card widths rather than a sub-card footprint.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --test tests/scene/card-previews.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scene/card-previews.js tests/scene/card-previews.test.js
git commit -m "fix: enlarge card preview models"
```

### Task 2: Keep Guides Visible And Correctly Layered

**Files:**
- Modify: `src/scene/placement-guide-overlay.js`
- Modify: `src/styles/app.css`
- Test: `tests/scene/placement-guide-overlay.test.js` if the file exists, otherwise add it.

**Interfaces:**
- Consumes: scan-phase calls to `show()` and battle/result calls to `hide()`.
- Produces: three non-interactive screen-space lines visible above the MindAR video and below application controls.

- [ ] **Step 1: Add tests for line count and lifecycle**

Assert that constructing the overlay creates exactly three lines, `show()` unhides the host, `hide()` hides it, and every line has `pointer-events: none` through the production class/style contract.

- [ ] **Step 2: Run the focused guide test and verify the current behavior**

Run: `node --test tests/scene/placement-guide-overlay.test.js`

Expected: the test either exposes the missing test harness/file or identifies any lifecycle mismatch before CSS changes.

- [ ] **Step 3: Fix the stacking contract**

Ensure `#ar-root` is the bottom camera layer, `.placement-guide` is above MindAR video nodes inside that container, `#scene` remains the transparent WebGL layer above it, and `#ui` remains the interactive top layer. Keep guide lines 1px wide, transparent, and pointer-inert. Do not draw fallback 3D lines when no card is detected.

- [ ] **Step 4: Run guide and existing scene tests**

Run: `node --test tests/scene/*.test.js`

Expected: PASS with no regressions to `GuideLines` or arena mesh tests.

- [ ] **Step 5: Commit**

```bash
git add src/scene/placement-guide-overlay.js src/styles/app.css tests/scene/placement-guide-overlay.test.js
git commit -m "fix: keep AR placement guides visible"
```

### Task 3: Make Battle Targeting Role-Accurate

**Files:**
- Modify: `src/core/battle-field.js`
- Modify: `src/core/battle-system.js`
- Modify: `src/core/unit-definitions.js` only if tests demonstrate a range/speed mismatch.
- Test: `tests/core/battle-field.test.js`
- Test: `tests/core/battle-system.test.js`

**Interfaces:**
- Consumes: normalized unit records with `id`, `type`, `faction`, `position`, `health`, `alive`, and cooldown.
- Produces: deterministic `attack`, `impact`, `move`, `destroy`, and `victory` events with living, in-range targets only.

- [ ] **Step 1: Add failing battle scenarios**

Cover these exact rules:

```js
test('base never becomes an attacker', () => {
  // configure a base near an enemy and assert no attack event has the base id
});

test('artillery attacks the nearest living target in range', () => {
  // put two enemy units in range and assert targetId is the nearer id
});

test('a dead target is skipped and the next living target is selected', () => {
  // mark the nearest enemy dead and assert the farther living target is selected
});

test('both factions can attack during the same fixed step', () => {
  // place one attacker per side in range and assert both attack events occur
});
```

- [ ] **Step 2: Run the focused core tests and verify the new cases fail if needed**

Run: `node --test tests/core/battle-field.test.js tests/core/battle-system.test.js`

Expected: existing tests pass; any new regression case fails before the implementation correction.

- [ ] **Step 3: Correct target selection and movement fallback**

Keep `targetFor()` restricted to living enemies inside the attacker range and preserve deterministic distance/id tie-breaking. Ensure `advance()` targets the enemy base when no attackable unit exists, stops at `BASE_STANDOFF`, never moves bases, and does not select a dead base. In `BattleSystem.#step`, process every living unit independently, recharge cooldowns for attackers, emit attack/impact, destroy zero-health targets once, and continue processing the opposing faction in the same fixed step unless the base victory condition has already ended the battle.

- [ ] **Step 4: Run all core tests**

Run: `node --test tests/core/*.test.js`

Expected: PASS, including determinism, movement, two-way damage, target selection, and full battle completion.

- [ ] **Step 5: Commit**

```bash
git add src/core/battle-field.js src/core/battle-system.js src/core/unit-definitions.js tests/core/battle-field.test.js tests/core/battle-system.test.js
git commit -m "fix: align battle targeting with unit roles"
```

### Task 4: Scale Battle Models Without Breaking Simulation

**Files:**
- Modify: `src/app/game-controller.js`
- Modify: `src/scene/units/base-unit.js` only if the model transform needs a visual-only scale layer.
- Test: relevant controller or scene tests, plus `tests/scene/unit-walk.test.js` if motion setup changes.

**Interfaces:**
- Consumes: calibrated arena positions and domain coordinates from `BattleSystem`.
- Produces: readable structures and units whose visual transforms are enlarged without changing logical attack positions or ranges.

- [ ] **Step 1: Add a regression assertion for visual scale isolation**

Assert that changing the visual scale factor does not change the battle record positions, range checks, or movement speed. Keep the domain records in calibrated arena coordinates.

- [ ] **Step 2: Implement a visual-only scale factor**

Introduce a named battle visual scale in `game-controller.js` and apply it to rendered structure/unit groups after creation. Do not multiply `records.position`, `arena.scale`, `UNIT_DEFINITIONS.range`, or `UNIT_DEFINITIONS.speed`. Clamp the factor to a finite positive value and retain the existing spawn/walk goals in logical arena coordinates.

- [ ] **Step 3: Verify HUD and effects follow the enlarged model**

Run the scene update path and ensure `UnitHud.update(camera)` still derives the bar position from each object's world transform. Ensure attack and impact effects resolve the model's current world position and do not use a stale card anchor.

- [ ] **Step 4: Run the complete automated suite**

Run: `npm test`

Expected: all tests pass with no changes to pure battle outcomes.

- [ ] **Step 5: Build the production bundle**

Run: `npm run build`

Expected: Vite exits with status 0 and emits the application and MindAR chunks.

- [ ] **Step 6: Commit**

```bash
git add src/app/game-controller.js src/scene/units/base-unit.js tests
git commit -m "fix: enlarge battle models without changing combat math"
```

### Task 5: Manual AR Smoke Check

**Files:**
- No source changes unless a verified browser issue is found.

- [ ] **Step 1: Start the development server**

Run: `npm run dev -- --host 127.0.0.1`

- [ ] **Step 2: Verify scan behavior in Chrome**

Confirm the camera opens, all three guide lines are visible before any card is detected, each detected card immediately gets exactly one model, models appear one at a time as cards enter view, and a lost card removes only its own preview.

- [ ] **Step 3: Verify battle behavior**

Place one valid three-card team on each side. Confirm previews are replaced by one battle model per card, soldiers advance toward enemies, artillery stops at range, bases do not attack, both sides receive damage, and the match ends when one base is destroyed.

- [ ] **Step 4: Verify scale and cleanup**

Confirm preview models are approximately 1.5-2 times the card width, battle models remain readable, HP bars stay above models, guides disappear at battle start, and replay does not duplicate models.
