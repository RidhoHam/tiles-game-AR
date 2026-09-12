# Test Mode Interaction Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selectable Test mode alongside Battle mode so one card placed at the center produces one interactive 3D object with a visible action list.

**Architecture:** Keep MindAR and the existing card tracker as the single source of card poses. Add a mode selection before scanning, route Battle mode to the current six-card flow, and route Test mode to a dedicated test screen/controller path that owns exactly one preview model and exposes explicit actions. Reuse existing sand structure/unit factories, HUD, effects, and cleanup lifecycle instead of duplicating model construction.

**Tech Stack:** Vite, Three.js, MindAR 1.2.5, Node test runner, ES modules, existing DOM wizard UI.

## Global Constraints

- Two user-selectable modes are required: `test` and `battle`.
- Test mode accepts one detected card and does not require six cards or team validation.
- The test card is expected to be placed near the center of the camera view; its pose remains the authoritative transform.
- Test mode displays one 3D model for the currently visible card, one model maximum.
- Test mode actions are: Idle/Reset, Build/Spawn, Attack/Action, Hit/Damage, Destroy, Rotate left/right, and Scale up/down.
- Battle mode keeps the current six-card validation and battle behavior unchanged.
- Test mode must not start the BattleSystem or create duplicate battle structures/units.
- A lost card must remove the test model and clear its HUD/effects state safely.
- All action buttons must be disabled or report unavailable when no card/model is visible.
- `src/core/` remains free of Three.js, DOM, MindAR, and browser-only imports.
- Run `npm test` and `npm run build` before completion.

---

### Task 1: Add Mode State And Selection UI

**Files:**
- Modify: `src/ui/app-state.js`
- Modify: `src/ui/screens/screen-camera.js`
- Modify: `src/ui/wizard.js`
- Modify: `src/styles/app.css`
- Test: `tests/ui/app-state.test.js`
- Test: `tests/ui/components.test.js` or a new focused screen test if the existing harness supports it.

**Interfaces:**
- Produces `state.mode` with values `test` or `battle`.
- Produces camera handlers `onSelectMode(mode)` and keeps the existing camera start handler.
- `mountWizard()` passes the selected mode into later phase handlers/screens.

- [ ] **Step 1: Write failing state tests**

Add tests asserting the initial mode is `battle`, only `test` and `battle` are accepted, and selecting a mode emits a state snapshot:

```js
const state = createAppState();
assert.equal(state.mode, 'battle');
assert.equal(state.setMode('test'), true);
assert.equal(state.mode, 'test');
assert.equal(state.setMode('invalid'), false);
assert.equal(state.mode, 'test');
```

- [ ] **Step 2: Run the state test and verify it fails**

Run: `node --test tests/ui/app-state.test.js`

Expected: FAIL because `mode` and `setMode()` do not exist.

- [ ] **Step 3: Implement mode state and camera controls**

Add `MODES = ['test', 'battle']`, expose `mode`, and implement `setMode(mode)` with boolean success. Update the camera screen with two clearly labeled buttons: `Mode Test` and `Mode Battle`; selecting one calls `setMode()` and visually marks the active choice. Starting the camera remains a separate action.

- [ ] **Step 4: Route wizard factories by mode**

Keep the existing phase names where possible. The camera screen selects `state.mode`; after camera startup, the controller transitions to `test`-specific scan behavior or existing battle scan behavior based on `state.mode`. Do not render the battle six-card instructions when `mode === 'test'`.

- [ ] **Step 5: Add mode styling and run UI tests**

Style the mode selector as two accessible buttons, preserve the current panel layout, and run:

```text
node --test tests/ui/app-state.test.js tests/ui/components.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit when Git metadata is available**

```bash
git add src/ui/app-state.js src/ui/screens/screen-camera.js src/ui/wizard.js src/styles/app.css tests/ui
git commit -m "feat: add test and battle mode selection"
```

If the workspace has no Git metadata, do not fabricate a commit; record that validation limitation.

### Task 2: Build Dedicated Test Scan Screen

**Files:**
- Create: `src/ui/screens/screen-test.js`
- Modify: `src/ui/wizard.js`
- Modify: `src/styles/app.css`
- Test: `tests/ui/screen-test.test.js`

**Interfaces:**
- `createScreenTest(root, state, handlers)` returns `{ update, setActionState, dispose }`.
- `update({ card, model, title, status })` refreshes the detected-card status and action availability.
- Handlers are `onAction(action)`, `onRescan()`, and `onBack()`.

- [ ] **Step 1: Define the test screen contract and failing tests**

Test that the screen renders a test-mode heading, one card status area, all seven action labels, and disables action buttons when `model` is absent. Test that an available model enables the actions and that clicking an action calls `onAction(action)` with the expected action key.

- [ ] **Step 2: Run the focused screen test and verify it fails**

Run: `node --test tests/ui/screen-test.test.js`

Expected: FAIL because the screen module does not exist.

- [ ] **Step 3: Implement the screen**

Use action keys exactly as follows:

```text
reset, build, action, damage, destroy, rotate-left, rotate-right, scale-up, scale-down
```

Render the detected card title, `Belum ada kartu` / `Kartu terdeteksi`, a short status message, the action grid, `Pindai Ulang`, and `Kembali`. Use `aria-label` and disabled states so the screen is usable without guessing.

- [ ] **Step 4: Wire screen selection**

Add the `test` screen factory without changing the existing battle screen behavior. Ensure leaving test mode disposes the screen and does not leave stale buttons in the outlet.

- [ ] **Step 5: Run UI tests**

Run: `node --test tests/ui/screen-test.test.js tests/ui/app-state.test.js tests/ui/components.test.js`

Expected: PASS.

- [ ] **Step 6: Commit when Git metadata is available**

```bash
git add src/ui/screens/screen-test.js src/ui/wizard.js src/styles/app.css tests/ui/screen-test.test.js
git commit -m "feat: add test mode interaction panel"
```

### Task 3: Implement One-Card Test Model Lifecycle

**Files:**
- Create: `src/scene/test-model-controller.js`
- Modify: `src/scene/scene-system.js` only if a re-export is useful.
- Modify: `src/app/game-controller.js`
- Test: `tests/scene/test-model-controller.test.js`

**Interfaces:**
- `TestModelController` constructor accepts `{ systems, root, hud, effects }`.
- `sync(card)` creates/reuses one model from `systems.create(card.type, position)` and applies the card pose.
- `clear()` disposes the model and detaches HUD state.
- `model`, `card`, `scale`, and `available` are read-only state accessors.
- `perform(action)` returns `{ ok, message }` and never throws for a missing model.

- [ ] **Step 1: Add lifecycle tests**

Cover one-card creation, model reuse across pose updates, replacement when card type changes, clearing on card loss, and the invariant `root` has at most one test model. Use a valid 16-element pose and existing Three.js test setup.

- [ ] **Step 2: Run the focused test and verify missing implementation fails**

Run: `node --test tests/scene/test-model-controller.test.js`

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement pose and scale handling**

Use the same MindAR pose convention as `CardPreviews`: marker pose, marker-plane orientation correction, faction-neutral yaw for test mode, and a readable scale based on the existing enlarged preview scale. Test mode must not use `BattleSystem` coordinates or arena team classification. The current detected card is the only model source.

- [ ] **Step 4: Implement safe sync and clear**

When `sync(null)` is called, dispose the model, detach HUD, clear target state, and remove any test-owned effects. When a new card type arrives, dispose the old model before creating the new one. Repeated `clear()` must be safe.

- [ ] **Step 5: Integrate controller with `game-controller.js`**

Create the test controller once per game controller. In `handleCards()`, when `state.mode === 'test'`, select the first valid detected card only and call `testModel.sync(card)`; do not call `validateTeams()` to start battle. Keep all detected cards available for the battle path. Update the test screen with the selected card and model state.

- [ ] **Step 6: Run scene and controller-adjacent tests**

Run: `node --test tests/scene/test-model-controller.test.js tests/scene/card-previews.test.js tests/scene/unit-hud.test.js`

Expected: PASS.

- [ ] **Step 7: Commit when Git metadata is available**

```bash
git add src/scene/test-model-controller.js src/app/game-controller.js src/scene/scene-system.js tests/scene/test-model-controller.test.js
git commit -m "feat: show one tracked card model in test mode"
```

### Task 4: Add Test Interactions

**Files:**
- Modify: `src/scene/test-model-controller.js`
- Modify: `src/app/game-controller.js`
- Modify: `src/scene/sand-structures.js` only for an existing public action/reset limitation.
- Test: `tests/scene/test-model-controller.test.js`

**Interfaces:**
- `perform('reset')` restores a visible idle model.
- `perform('build')` runs the existing sand build/materialise behavior.
- `perform('action')` calls the model’s existing action animation.
- `perform('damage')` applies a visible non-lethal damage step and updates HP.
- `perform('destroy')` runs collapse and clears the model after its animation lifecycle.
- `perform('rotate-left'|'rotate-right')` changes model yaw by a fixed 15 degrees.
- `perform('scale-up'|'scale-down')` changes visual scale by a fixed factor, clamped to readable bounds.

- [ ] **Step 1: Add failing interaction tests**

Assert each action returns `ok: true` with a model, changes the expected state/transform, and returns `ok: false` with a clear message when no model is available. Assert scale never leaves the defined minimum/maximum bounds and damage never makes HP negative.

- [ ] **Step 2: Run focused interaction tests and verify failures**

Run: `node --test tests/scene/test-model-controller.test.js`

Expected: FAIL for unimplemented action behavior.

- [ ] **Step 3: Implement action dispatch**

Use existing methods wherever available: `build({ immediate: false })`, `act()`, `damage(amount)`, `destroy()`, and `dispose()`. For reset, dispose and recreate the current card model if the existing structure state cannot be safely rebuilt. Keep test actions visual/local; they must not emit battle events or mutate BattleSystem.

- [ ] **Step 4: Connect UI actions**

Route `screen-test` button keys through the test phase handler in `game-controller.js`, call `testModel.perform(action)`, refresh HUD/status, and show a toast for rejected actions. The action buttons remain present while a card is tracked and disable when tracking is lost.

- [ ] **Step 5: Run interaction and full tests**

Run:

```text
node --test tests/scene/test-model-controller.test.js tests/ui/screen-test.test.js
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit when Git metadata is available**

```bash
git add src/scene/test-model-controller.js src/app/game-controller.js src/scene/sand-structures.js tests/scene/test-model-controller.test.js
git commit -m "feat: add interactive test model actions"
```

### Task 5: Mode-Specific Cleanup And Production Validation

**Files:**
- Modify: `src/app/game-controller.js`
- Modify: `src/ui/app-state.js` if transition cleanup requires a mode reset.
- Test: `tests/ui/app-state.test.js`, `tests/scene/test-model-controller.test.js`, and existing lifecycle tests.

- [ ] **Step 1: Add mode cleanup tests**

Verify test-to-battle switching clears the one-card model before battle models are created, battle-to-test switching clears structures/units, replay does not duplicate models, and camera/tracking is not stopped unnecessarily.

- [ ] **Step 2: Implement cleanup boundaries**

On every phase/mode change, dispose test-owned model/HUD resources before creating battle-owned resources. Ensure `dispose()` clears both test and battle maps. Keep `CardPreviews` active only for battle scan; test mode uses the dedicated one-model controller.

- [ ] **Step 3: Run complete automated validation**

Run:

```text
npm test
npm run build
```

Expected: all tests pass and Vite exits with status 0. Existing large-chunk warnings may remain but must not become build failures.

- [ ] **Step 4: Perform Chrome smoke test**

Run `npm run dev -- --host 127.0.0.1`, open the app in Chrome, and verify:

1. Choose `Mode Test`.
2. Start camera and place one printed card near the center.
3. Confirm exactly one 3D model appears and follows the card.
4. Confirm the action list is disabled before detection and enabled after detection.
5. Try build, action, damage, destroy, rotate, and scale controls.
6. Hide the card and confirm the model and HP bar disappear.
7. Choose `Mode Battle`, confirm the six-card scan and existing battle flow still work.

- [ ] **Step 5: Commit final changes when Git metadata is available**

```bash
git add src tests docs/superpowers/plans/2026-09-12-test-mode-interaction-plan.md
git commit -m "feat: add selectable card test mode"
```
