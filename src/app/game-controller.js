import * as THREE from 'three';
import { BattleSystem } from '../core/battle-system.js';
import { deriveArena } from '../core/arena-layout.js';
import { validateTeams, classifySide } from '../core/team-composition.js';
import { UNIT_DEFINITIONS } from '../core/unit-definitions.js';
import { createSceneSystem, ArenaMesh, GuideLines, PlacementGuideOverlay } from '../scene/scene-system.js';
import { KNOWN_TOPS, UnitHud, defaultBarHeight } from '../scene/unit-hud.js';
import { createUnit } from '../scene/units/unit-factory.js';
import { CardTrackingController } from '../ar/ar-marker.js';
import { createAppState } from '../ui/app-state.js';
import { mountWizard } from '../ui/wizard.js';
import { createToast } from '../ui/components/toast.js';
import { AudioSystem } from '../audio/audio-system.js';

import { CardPreviews } from '../scene/card-previews.js';
import { TestModelController } from '../scene/test-model-controller.js';

// Enlarge battle models only at the presentation layer. Arena calibration,
// BattleSystem coordinates, ranges, and speeds remain in their original units.
export const BATTLE_VISUAL_SCALE = 2;

function finitePositiveScale(value, fallback = 1) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function applyBattleVisualScale(object3D, factor = BATTLE_VISUAL_SCALE) {
  const scale = finitePositiveScale(factor);
  object3D?.group?.scale.multiplyScalar(scale);
  return scale;
}

// HUD attachment happens immediately after build(), while the model parts are
// still invisible. Prefer a real measured top when one exists; otherwise use
// the known unscaled top multiplied by the presentation scale and retain the
// HUD's normal clearance margin.
export function battleHudHeight(object3D, type, factor = BATTLE_VISUAL_SCALE) {
  const scale = finitePositiveScale(factor);
  try {
    let hasVisiblePart = false;
    object3D?.traverse?.(child => { if (child.isMesh && child.visible) hasVisiblePart = true; });
    if (hasVisiblePart) {
      object3D.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(object3D);
      if (!bounds.isEmpty() && Number.isFinite(bounds.max.y)) {
        const top = KNOWN_TOPS[type];
        const margin = Number.isFinite(top) ? defaultBarHeight(type) - top : 0.55;
        return bounds.max.y + margin;
      }
    }
  } catch { /* use the known top while the build is invisible */ }

  const top = KNOWN_TOPS[type];
  const margin = Number.isFinite(top) ? defaultBarHeight(type) - top : 0.55;
  return (top ?? defaultBarHeight(type) - margin) * scale + margin;
}

// ---------------------------------------------------------------------------
// Card -> battlefield bridge
// ---------------------------------------------------------------------------
//
// `normalizeDetections` (src/ar/card-tracking.js) emits
// `{ cardId, type, role, worldPosition: [x, y, z], pose }`, while
// `validateTeams` (src/core/team-composition.js) reads `card.x` (and an optional
// `card.centerX`) and `deriveArena` (src/core/arena-layout.js) reads
// `card.worldPosition`. Passing detections straight to `validateTeams` left
// EVERY card with `x === undefined`, `classifySide(undefined)` returned null, and
// every card was rejected as "berada tepat di garis tengah".
//
// `reconcileCards` is the single bridge that satisfies EVERY consumer at once:
//
//   - `x`         = `worldPosition[0]`, the alias `validateTeams` reads.
//   - `centerX`   = the arena centre for THIS set of detections, forwarded to the
//                   validator so its `classifySide` splits the table at exactly
//                   the same place `deriveArena` re-centres the scene on. An
//                   empty set returns early, so no card is ever stamped with a
//                   centre that no other consumer agrees with.
//   - `side`      = `blue`/`red`/`null` from that same split. The scan screen
//                   shows a per-card side label from this; without it every
//                   detected card rendered as if it sat on the centre line.
//   - `faction`   = the alias `createBattlefield` reads when it builds
//                   `{ faction }` unit records. It was never assigned anywhere
//                   before, so every unit reached `BattleSystem.configure` with
//                   `faction === undefined`, `valid` was always false and a
//                   perfectly complete 3v3 layout could NEVER start a battle.
//                   `side` and `faction` are the same value by construction.
function reconcileCards(detections) {
  const list = (detections ?? [])
    .filter(card => Array.isArray(card?.worldPosition) && card.worldPosition.length === 3);
  if (list.length === 0) return [];

  // `deriveArena` ignores malformed positions on its own; stamping the centre it
  // reports keeps the validator, the arena fit and the scan screen in lockstep.
  const centerX = deriveArena(list).centerX;

  return list.map(card => {
    const x = card.worldPosition[0];
    const side = classifySide(x, centerX);
    return { ...card, x, centerX, side, faction: side };
  });
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function selectTestCard(cards = []) {
  return cards.find(card =>
    UNIT_DEFINITIONS[card?.type]
    && Array.isArray(card?.pose)
    && card.pose.length === 16
    && card.pose.every(Number.isFinite)
  ) ?? null;
}

export function resetModeResources({ clearTimeouts, clearBattlefield, clearTestModel } = {}) {
  clearTimeouts?.();
  clearBattlefield?.();
  clearTestModel?.();
}

// Live world position of a model, read from the model's OWN transform. Battle
// events carry logical coordinates (or nothing at all), but the visual effect
// must appear where the MODEL actually is, so effects resolve the position from
// the unit/structure map rather than from the event payload.
function worldSpot(object3D) {
  const position = object3D?.group?.position;
  if (!isFiniteNumber(position?.x) || !isFiniteNumber(position?.y) || !isFiniteNumber(position?.z)) return null;
  return position;
}

export function createGameController({ canvas, root, container, capacity } = {}) {
  const { renderer, scene, camera, root: sceneRoot, systems } = createSceneSystem(canvas, capacity);
  const audio = new AudioSystem();
  const state = createAppState();

  const arenaMesh = new ArenaMesh(sceneRoot);
  const guideLines = new GuideLines(sceneRoot);
  const hud = new UnitHud(sceneRoot);

  // The single particle pool, shared with the structures. Battle effects call its
  // named presets (unitMaterialise / unitHit / unitCollapse) rather than
  // `burst()` directly, so the tuning lives in sand-effects.js. `systems.update`
  // already ticks it each frame; nothing extra is needed here.
  const effects = systems.effects;

  const clock = new THREE.Clock();
  const timeouts = new Set();

  // `container` is the element MindAR builds its <video>/overlay inside. It falls
  // back to the UI root so the app still boots if the markup has not been updated
  // yet; index.html provides a dedicated #ar-root.
  const arContainer = container ?? root ?? null;

  // The screen-space placement guide is a DOM overlay on the camera feed, so it
  // is created once the AR container is known and lives for the whole session.
  const placementGuide = new PlacementGuideOverlay(arContainer);

  let battle = null;
  let arena = null;
  let cards = [];
  let structures = new Map();  // unitId -> sand structure
  let units = new Map();       // unitId -> walking sand unit
  let tracking = null;
  let wizard = null;
  let toast = null;
  let running = false;
  let lastMove = new Map();

  // Battle previews are lazy: test mode owns the only model path and must never
  // allocate the battle preview collection.
  let previews = null;
  const battlePreviews = () => previews ?? (previews = new CardPreviews(systems, sceneRoot));
  const clearPreviews = () => previews?.clear();
  const testModel = new TestModelController({ systems, root: sceneRoot, hud, effects });
  let disposed = false;
  let previousMode = state.mode;
  const unsubscribePreviews = state.subscribe(({ phase, mode }) => {
    if (mode !== previousMode) {
      resetModeResources({ clearTimeouts, clearBattlefield, clearTestModel: () => testModel.clear() });
      previousMode = mode;
    }
    if (phase !== 'scan' || mode !== 'battle') clearPreviews();
    if (phase !== 'scan' || mode !== 'test') testModel.clear();
  });
  const unitContext = () => ({ system: systems, material: systems.material, dark: systems.dark, primary: systems.material, root: sceneRoot });
  const later = (fn, delay) => {
    const id = setTimeout(() => { timeouts.delete(id); fn(); }, delay);
    timeouts.add(id);
    return id;
  };

  function clearTimeouts() {
    for (const id of timeouts) clearTimeout(id);
    timeouts.clear();
  }

  function showToast(message) { toast?.show(message); }

  function screen() { return wizard?.current?.() ?? null; }

  function clearBattlefield() {
    for (const structure of structures.values()) structure?.dispose?.();
    structures = new Map();
    for (const [unitId, unit] of units) {
      hud.detach(unitId);
      unit?.dispose?.();
    }
    units = new Map();
    lastMove = new Map();
    battle = null;
    arena = null;
  }

  // ---------------------------------------------------------------------------
  // Unit identity
  // ---------------------------------------------------------------------------
  //
  // Ids follow BattleSystem's `${faction}-${type}-${index}` scheme. Every card has
  // EXACTLY one unit (`index` is always 0), and the validator guarantees one
  // card per type per side, so `${faction}-${type}-0` is unique across the board.
  // Using it as the single key for the structure map, the unit map, the HUD and
  // the battle records is what lets a battle event name a model to animate.
  const unitId = card => `${card.faction}-${card.type}-0`;

  /**
   * Card index within its own faction, used only for the (cosmetic) build delay
   * so the three units of a side do not all erupt on the same frame.
   */
  function factionIndex(card) {
    return cards.filter(other => other.faction === card.faction).indexOf(card);
  }

  // ---------------------------------------------------------------------------
  // Battle setup: card layout -> structures + walking units + BattleSystem
  // ---------------------------------------------------------------------------

  /**
   * Builds the battlefield from the VALIDATED card list.
   *
   * Every structure sits at the card's OWN world position scaled by the
   * arena fit (`scale` maps the physical table spread onto the scene, and the
   * `centerX`/`centerZ` offsets re-centre the table on the origin). No position
   * is hardcoded: moving a card on the table moves its building in the scene.
   *
   * Each unit then WALKS out of its card toward the middle. `walkTo` records a
   * goal and advances it over time in `update(dt)`; `moveTo` (an instant
   * teleport) is deliberately never used here.
   */
  function createBattlefield(validatedCards, calibratedArena) {
    clearBattlefield();
    arena = calibratedArena;
    cards = validatedCards;

    battle = new BattleSystem({ onEvent: handleBattleEvent });

    const scale = isFiniteNumber(arena?.scale) && arena.scale > 0 ? arena.scale : 1;
    const centerX = isFiniteNumber(arena?.centerX) ? arena.centerX : 0;
    const centerZ = isFiniteNumber(arena?.centerZ) ? arena.centerZ : 0;

    const toWorld = card => ({
      x: centerX + (card.worldPosition[0] - centerX) * scale,
      z: centerZ + (card.worldPosition[2] - centerZ) * scale
    });

    // A unit's build animation materialises it from a LOCAL spawn offset before it
    // walks out. The scene default is (0, 0, 2.1) world units; on a real table the
    // arena is only ~0.4 units wide, so that offset would drop every unit far
    // outside its own card. This is the "about one card row" distance, clamped to
    // the arena's own depth so it is always small, finite and positive.
    const depth = Number.isFinite(arena?.depth) && arena.depth > 0 ? arena.depth : 0;
    const spawnOffset = Math.min(2.1, Math.max(0.06, depth * 0.5));

    const records = [];
    const index = factionIndex;

    for (const card of validatedCards) {
      const id = unitId(card);
      const spot = toWorld(card);

      // 1. The building at the card's own world position.
      const structure = systems.create(card.type, new THREE.Vector3(spot.x, 0, spot.z));
      structure.group.rotation.y = card.faction === 'blue' ? Math.PI / 2 : -Math.PI / 2;
      applyBattleVisualScale(structure);
      structure.build();
      structures.set(id, structure);

      // 2. The unit, spawned at the card and told to walk toward the centre.
      const unit = createUnit(card.type, unitContext(), {
        position: new THREE.Vector3(spot.x, 0, spot.z),
        faction: card.faction,
        index: index(card),
        // Materialise a short distance in front of the card, inside the arena, so
        // the sand-assembly animation happens on the table rather than off it.
        // `walkTo` then carries the unit the rest of the way to its goal.
       spawnOffset: new THREE.Vector3(0, 0, spawnOffset)
      });
      applyBattleVisualScale(unit);
      unit.build();

      // The goal is a point 45% of the way from this card to the arena centre.
      // It is deliberately NOT the anchor itself: a short walk toward the middle
      // keeps every unit in its own lane (units visibly fan out of their cards)
      // without ever placing one inside the enemy formation before the battle
      // system has had a chance to move it.
      unit.walkTo(
        spot.x + (centerX - spot.x) * 0.45,
        spot.z + (centerZ - spot.z) * 0.45
      );
      units.set(id, unit);

       hud.attach(id, unit.group, {
         type: card.type,
         title: UNIT_DEFINITIONS[card.type]?.title ?? card.type,
         faction: card.faction,
         height: battleHudHeight(unit.group, card.type),
         health: unit.health,
        maxHealth: unit.maxHealth
      });

      records.push({
        id,
        type: card.type,
        faction: card.faction,
        health: unit.health,
        maxHealth: unit.maxHealth,
        cooldown: 0,
        position: { x: spot.x, z: spot.z },
        targetId: null,
        alive: true
      });
    }

    const validation = battle.configure({ units: records });
    if (!validation.valid) {
      showToast('Battle tidak bisa dimulai: komposisi tim tidak seimbang.');
      return { valid: false, validation };
    }
    return { valid: true, validation };
  }

  function handleBattleEvent(event) {
    audio.handleEvent(event);

    if (event.type === 'attack') {
      const structure = structures.get(event.unitId);
      if (structure) {
        // The building flinches: toggle/play its model action, then fall back.
        structure.actionActive = true;
        later(() => { structure.actionActive = false; }, 350);
      } else {
        units.get(event.unitId)?.act?.();
      }
      // Muzzle puff at the attacker's own world position. `systems.effects` is
      // the SAME SandEffects instance the structures already use, so this shares
      // the existing particle pool instead of adding a second system.
      const attacker = units.get(event.unitId);
      effects.unitMaterialise(worldSpot(attacker) ?? worldSpot(structures.get(event.unitId)));
    }

    if (event.type === 'impact') {
      // `health` is the target's health AFTER the hit, which is exactly what the
      // HUD wants; the moving bar is refreshed from the event, not re-derived.
      hud.setHealth(event.targetId, event.health, maxHealthOf(event.targetId));
      hud.setTarget(event.unitId, event.targetId);
      const structure = structures.get(event.targetId);
      if (structure?.state === 'built') {
        // Keep at least 1 visual HP so only BattleSystem's `destroy` event may
        // collapse a model, never an impact the simulation has not confirmed.
        const amount = Math.min(event.damage, Math.max(0, structure.health - 1));
        if (amount > 0) structure.damage(amount);
      }
      const unit = units.get(event.targetId);
      if (unit && event.damage > 0) unit.damage(Math.min(event.damage, Math.max(0, unit.health - 1)));
      // Hit puff at the TARGET's own position, so a late event for a unit that
      // has already been destroyed is a silent no-op rather than a throw.
      effects.unitHit(worldSpot(units.get(event.targetId)) ?? worldSpot(structure));
    }

    if (event.type === 'move') {
      // A move event drives the VISIBLE walk to the simulation's position. This
      // re-issues a walking goal (never a teleport) so the model follows the
      // simulation instead of snapping to it.
      const unit = units.get(event.unitId);
      const previous = lastMove.get(event.unitId);
      if (unit && !(previous && Math.abs(previous.x - event.x) < 0.001 && Math.abs(previous.z - event.z) < 0.001)) {
        lastMove.set(event.unitId, { x: event.x, z: event.z });
        unit.walkTo(event.x, event.z);
      }
    }

    if (event.type === 'destroy') {
      const structure = structures.get(event.unitId);
      if (structure?.state === 'built') structure.destroy();
      // Collapse plume, read BEFORE the model is dropped from the maps below.
      effects.unitCollapse(worldSpot(structure) ?? worldSpot(units.get(event.unitId)));
      const unit = units.get(event.unitId);
      if (unit) {
        hud.detach(event.unitId);
        units.delete(event.unitId);
        lastMove.delete(event.unitId);
        unit.collapse?.();
        // The model owns its own sand-collapse animation; dispose only once it
        // has actually fallen so the player sees the unit crumble, not vanish.
        later(() => unit.dispose?.(), 1400);
      }
    }

    if (event.type === 'victory') {
      state.setWinner(event.winner);
      audio.playPhase('result');
      state.goTo('result');
    }
  }

  /**
   * The maxHealth the HUD should normalise a bar against.
   *
   * `impact` only carries the target's health AFTER the hit, so the denominator
   * is resolved here: the live battle record is authoritative (it is what the
   * simulation damaged), with the visual model as a fallback for a target the
   * battle system has already dropped.
   */
  function maxHealthOf(targetId) {
    const record = battle?.units?.get?.(targetId);
    if (isFiniteNumber(record?.maxHealth) && record.maxHealth > 0) return record.maxHealth;
    const unit = units.get(targetId);
    if (isFiniteNumber(unit?.maxHealth) && unit.maxHealth > 0) return unit.maxHealth;
    const definition = UNIT_DEFINITIONS[record?.type ?? '']?.maxHealth;
    return isFiniteNumber(definition) && definition > 0 ? definition : undefined;
  }

  // Sand units own their own grain lifecycle, so every live model must be ticked
  // every frame; systems.update() only walks structures and projectiles.
  function updateUnits(dt) {
    const formationRadius = units.size > 2 ? 2.3 : 1.5;
    for (const unit of units.values()) unit?.update?.(dt, { formationRadius });
  }

  // ---------------------------------------------------------------------------
  // Phase handlers
  // ---------------------------------------------------------------------------

  async function startTracking() {
    if (tracking) return true;

    // The audio unlock MUST happen inside the click gesture: browsers only grant
    // an AudioContext off a user action. Awaiting it first is what makes the
    // battle music actually audible later.
    await audio.unlock();

    tracking = new CardTrackingController({
      container: arContainer,
      onCards: handleCards,
      onError: error => showToast(error?.message ?? 'Pelacakan kartu gagal.')
    });

    try {
      await tracking.start();
    } catch (error) {
      // start() rejects on a denied camera, a missing public/cards/targets.mind,
      // or an unsupported environment. Report it and STAY on the camera screen
      // so the player can fix it and retry; never white-screen.
      tracking?.dispose?.();
      tracking = null;
      const message = error?.message ?? 'Kamera atau berkas target kartu tidak tersedia.';
      showToast(message);
      screen()?.setError?.(message);
      return false;
    }

    state.next(); // camera -> scan
    handleCards([...tracking.cards.values()]);
    return true;
  }

  function handleCards(detections) {
    if (disposed) return;
    const reconciled = reconcileCards(detections);
    if (state.mode === 'test') {
      const card = selectTestCard(reconciled);
      testModel.sync(card);
      state.setCards(reconciled, null);
      if (state.phase === 'scan') screen()?.update?.({
        card,
        model: testModel.model,
         title: UNIT_DEFINITIONS[card?.type]?.title ?? card?.type ?? '',
         actionLabel: testModel.model?.actionLabel ?? '',
        status: card ? (testModel.model ? 'Model siap diuji.' : 'Pose kartu tidak tersedia.') : 'Arahkan kamera ke satu kartu.'
      });
      return;
    }
    if (state.phase === 'scan') battlePreviews().sync(reconciled);
    const result = validateTeams(reconciled);
    state.setCards(reconciled, result);
    if (state.phase === 'scan') screen()?.update?.({ cards: reconciled, errors: result.errors, valid: result.valid });
  }
  function beginBattle() {
    if (disposed || state.phase !== 'scan') return false;
    const reconciled = state.cards ?? [];
    const result = validateTeams(reconciled);
    if (!result.valid) {
      showToast(result.errors[0] ?? 'Tim belum lengkap.');
      screen()?.update?.({ cards: reconciled, errors: result.errors, valid: false });
      return false;
    }

    // The previews are DISPOSED here, never re-parented into the battle. Reason:
    // the battle builds its own models at arena-fit world positions, and a
    // reparented preview would be a SECOND model of the same card - the exact
    // "duplicate model in the arena" failure. Disposing first also guarantees
    // nothing survives `createBattlefield`'s `clearBattlefield()` (which only
    // knows about `structures`/`units`).
    clearPreviews();

    // `deriveArena` reads `worldPosition`; the reconciled cards carry both that
    // and the `x` alias, so the SAME array feeds the validator and the arena fit.
    const calibrated = deriveArena(reconciled);
    arenaMesh.apply(calibrated);
    // Both placement guides belong to `scan` only: the battle is about to take
    // the table over, so nothing may be drawn over the units.
    guideLines.hide();
    placementGuide.hide();

    const built = createBattlefield(reconciled, calibrated);
    if (!built.valid) return false;

    if (!battle.start()) {
      showToast('Battle tidak bisa dimulai.');
      return false;
    }
    audio.playPhase('battle');
    state.next(); // scan -> battle
    return true;
  }

  function replayBattle() {
    // `result -> scan` is the only legal edge out of result, and it deliberately
    // does NOT touch the camera: the player re-uses the same table layout and the
    // tracker keeps running, so the next battle starts from live detections.
    clearBattlefield();
    // Previews are cleared on the way back too: `scan` is reached with an empty
    // preview map, so a model can never survive a full battle/replay cycle into
    // the next scan.
    clearPreviews();
    // The arena mirrors are reset to the fallback box rather than disposed: the
    // same ArenaMesh instance is reused on the next battle and disposing it here
    // would leave an invisible floor behind the units.
    arenaMesh.apply(null);
    arena = null;
    state.goTo('scan');
  }

  function handleTestAction(action) {
    const result = testModel.perform(action);
    if (!result.ok) showToast(result.message);
    screen()?.update?.({
      card: testModel.card,
      model: testModel.model,
       title: UNIT_DEFINITIONS[testModel.card?.type]?.title ?? testModel.card?.type ?? '',
       actionLabel: testModel.model?.actionLabel ?? '',
      status: result.message
    });
    return result.ok;
  }

  function rescanTest() {
    handleCards(tracking ? [...tracking.cards.values()] : []);
  }

  function backFromTest() {
    testModel.clear();
    screen()?.update?.({ card: null, model: null, title: '', status: 'Model test dibersihkan.' });
    showToast('Model test dibersihkan.');
  }

  const handlers = {
    camera: {
      onStart() { return startTracking(); },
      onError(error) { showToast(error?.message ?? 'Kamera tidak bisa dimulai.'); }
    },
    scan: {
      onStart() { return state.mode === 'test' ? true : beginBattle(); },
      // "Pindai Ulang" re-reads the CURRENT detection map and re-validates it.
      // The tracker is deliberately NOT stopped: stop() releases the camera and
      // the next start() would re-prompt for permission. A card that went out of
      // view is picked up on the tracker's own next poll regardless.
      onRescan() { return state.mode === 'test' ? rescanTest() : handleCards(tracking ? [...tracking.cards.values()] : []); },
      onAction(action) { if (state.mode === 'test') return handleTestAction(action); },
      onBack() { if (state.mode === 'test') return backFromTest(); }
    },
    battle: {
      onOpenMenu() { screen()?.openMenu?.(); },
      replay() { replayBattle(); },
      toggleMute() {
        audio.setMuted(!audio.muted);
        showToast(audio.muted ? 'Audio dimatikan.' : 'Audio dinyalakan.');
      }
    },
    result: {
      // Both result actions land on `scan` with the camera untouched; `Ulangi`
      // and `Pindai Ulang Kartu` differ only in the copy the player sees.
      onReplay() { replayBattle(); },
      onBackToWizard() { replayBattle(); }
    }
  };

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------

  function updateFrame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const phase = state.phase;

    if (phase === 'scan' && state.mode === 'battle') battlePreviews().sync(reconcileCards(tracking ? [...tracking.cards.values()] : []));
    systems.update(dt);
    updateUnits(dt);
    if (phase === 'scan' && state.mode === 'test') testModel.update(dt);

    if (battle && battle.state === 'running') battle.update(dt);

    updateGuides(phase);

    hud.update(camera);

    if (phase === 'battle') {
      const current = screen();
      if (current && typeof current.update === 'function') current.update(battle ? battle.snapshot() : null);
    }

    renderer.render(scene, camera);
  }

  /**
   * Drives BOTH placement guides for the current phase.
   *
   * The screen-space overlay is the ONE guide that is always useful: it is fixed
   * relative to the viewport, so it is visible and meaningful from the first
   * frame of `scan` with zero cards detected - exactly when the player needs to
   * be told where to put them. It costs no tracking and never moves.
   *
   * The calibrated 3D lines are layered on top ONLY once at least one card has
   * been detected: `deriveArena` returns an arbitrary fallback box (centre 0,0)
   * while no card is visible, so drawing them earlier would put three lines at a
   * virtual position unrelated to this table. `arenaForGuides` reports `null` in
   * that case and `GuideLines` is simply left hidden.
   *
   * Once `battle` starts both are hidden (see `beginBattle`), and the `scan`
   * phase on replay shows them again automatically because this runs every frame.
   */
  function updateGuides(phase) {
    if (phase !== 'scan') {
      placementGuide.hide();
      return;
    }

    placementGuide.show();

    const arena = arenaForGuides();
    if (arena) {
      guideLines.show(arena);
    } else {
      guideLines.hide();
    }
  }

  // While scanning, the calibrated guide lines straddle whatever spread has been
  // detected so the player can see the arena centre between the two card rows.
  // Returns `null` (and hides the 3D guide) while nothing has been detected, so
  // the lines are never positioned from `deriveArena`'s unrelated fallback box.
  function arenaForGuides() {
    const detections = tracking?.cards ? [...tracking.cards.values()] : [];
    const reconciled = reconcileCards(detections);
    if (reconciled.length === 0) return null;
    return deriveArena(reconciled);
  }

  function start() {
    wizard = mountWizard(root, state, handlers);
    toast = createToast(root);
    running = true;
    renderer.setAnimationLoop(updateFrame);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    unsubscribePreviews();
    testModel.dispose();
    if (running) {
      renderer.setAnimationLoop(null);
      running = false;
    }
    clearTimeouts();
    // Previews go first so their owned structures leave the scene before tracking stops.
    // be released before `tracking.dispose()` tears those groups down.
    clearPreviews();
    for (const [id, unit] of units) { hud.detach(id); unit?.dispose?.(); }
    units = new Map();
    cards = [];
    arena = null;
    lastMove = new Map();
    for (const structure of structures.values()) structure?.dispose?.();
    structures = new Map();
    battle = null;
    hud.dispose();
    arenaMesh.dispose();
    guideLines.dispose();
    placementGuide.dispose();
    tracking?.dispose?.();
    tracking = null;
    systems.dispose?.();
    audio.dispose?.();
    wizard?.dispose?.();
    wizard = null;
    toast?.dispose?.();
    toast = null;
  }

  return {
    start,
    dispose,
    state,
    get battle() { return battle; },
    get arena() { return arena; },
    get cards() { return cards; },
    get units() { return units; },
    get structures() { return structures; },
    // Exposed (read-only by convention) so a leak check can count live preview
    // models without reaching into module scope.
    get previews() { return previews?.models ?? new Map(); },
    audio
  };
}







