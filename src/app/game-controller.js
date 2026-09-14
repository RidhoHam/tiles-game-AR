import * as THREE from 'three';
import { BattleSystem } from '../core/battle-system.js';
import { deriveArena } from '../core/arena-layout.js';
import { validateTeams, classifySide } from '../core/team-composition.js';
import { UNIT_DEFINITIONS } from '../core/unit-definitions.js';
import { createSceneSystem, ArenaMesh, GuideLines, PlacementGuideOverlay } from '../scene/scene-system.js';
import { KNOWN_TOPS, UnitHud, defaultBarHeight } from '../scene/unit-hud.js';
import { createUnit } from '../scene/units/unit-factory.js';
import { CardTrackingController } from '../ar/ar-marker.js';
import { TARGET_FILES } from '../ar/card-targets.js';
import { createAppState } from '../ui/app-state.js';
import { mountWizard } from '../ui/wizard.js';
import { createToast } from '../ui/components/toast.js';
import { AudioSystem } from '../audio/audio-system.js';

import { CardPreviews, PREVIEW_SCALE } from '../scene/card-previews.js';
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
export function canStartBattle(cards) {
  const blue = (cards || []).filter(c => c.side === 'blue' || c.faction === 'blue');
  const red = (cards || []).filter(c => c.side === 'red' || c.faction === 'red');
  const blueAttackers = blue.filter(c => (UNIT_DEFINITIONS[c.type]?.damage ?? 0) > 0);
  const redAttackers = red.filter(c => (UNIT_DEFINITIONS[c.type]?.damage ?? 0) > 0);

  let canStart = blue.length > 0 && red.length > 0 && blueAttackers.length > 0 && redAttackers.length > 0;
  let reason = '';
  if (blue.length === 0 && red.length === 0) {
    reason = 'Letakkan kartu di kiri (Biru) & kanan (Merah).';
  } else if (blue.length === 0) {
    reason = 'Tim Biru (sisi kiri) belum memiliki kartu.';
  } else if (red.length === 0) {
    reason = 'Tim Merah (sisi kanan) belum memiliki kartu.';
  } else if (blueAttackers.length === 0) {
    reason = 'Tim Biru butuh setidaknya 1 penyerang (Prajurit/Artileri).';
  } else if (redAttackers.length === 0) {
    reason = 'Tim Merah butuh setidaknya 1 penyerang (Prajurit/Artileri).';
  }
  return { canStart, blue, red, reason };
}

function reconcileCards(detections) {
  const list = (detections ?? [])
    .filter(card => Array.isArray(card?.worldPosition) && card.worldPosition.length === 3);
  if (list.length === 0) return [];

  return list.map(card => {
    const x = card.worldPosition[0];
    // In camera space, X=0 is the center dividing line.
    // x < 0 is Tim Biru (left side of camera view), x > 0 is Tim Merah (right side).
    const side = classifySide(x, 0);
    return { ...card, x, centerX: 0, side, faction: side };
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
  let formationActive = false;

  // Persistent scanned cards to prevent handheld camera tremor from dropping models
  const scannedCards = new Map();
  let countdownTimer = null;
  let countdownSeconds = 0;
  let readyBanner = null;

  function registerScannedCard(card) {
    if (!card?.cardId || !Array.isArray(card.pose) || card.pose.length !== 16 || !card.pose.every(Number.isFinite)) return;
    scannedCards.set(card.cardId, {
      ...card,
      lastSeen: Date.now()
    });
  }

  function getEffectiveCards() {
    if (scannedCards.size > 0) {
      return [...scannedCards.values()];
    }
    return tracking ? [...tracking.cards.values()] : [];
  }

  function updateReadyBanner(seconds) {
    if (!root) return;
    if (typeof seconds === 'number' && seconds > 0 && state.phase === 'scan' && state.mode === 'battle') {
      if (!readyBanner) {
        readyBanner = document.createElement('div');
        readyBanner.className = 'ar-ready-banner';
        root.append(readyBanner);
      }
      readyBanner.innerHTML = `
        <span class="ar-ready-banner__icon">⚔️</span>
        <span class="ar-ready-banner__text">SEMUA MODEL SIAP! Battle otomatis dalam</span>
        <span class="ar-ready-banner__timer">${seconds}s</span>
      `;
    } else {
      if (readyBanner) {
        readyBanner.remove();
        readyBanner = null;
      }
    }
  }

  function notifyCountdown(seconds) {
    updateReadyBanner(seconds);
    wizard?.setCountdown?.(seconds);
    const currentList = getEffectiveCards();
    const reconciled = reconcileCards(currentList);
    const check = canStartBattle(reconciled);
    if (state.phase === 'scan') {
      screen()?.update?.({ cards: reconciled, errors: [], valid: check.canStart, countdown: seconds });
    }
  }

  function startAutoCountdown() {
    if (countdownTimer !== null || state.phase !== 'scan' || state.mode !== 'battle') return;
    countdownSeconds = 3;
    notifyCountdown(countdownSeconds);

    countdownTimer = setInterval(() => {
      countdownSeconds--;
      if (countdownSeconds > 0) {
        notifyCountdown(countdownSeconds);
      } else {
        cancelAutoCountdown();
        notifyCountdown(null);
        beginBattle();
      }
    }, 1000);
  }

  function cancelAutoCountdown() {
    if (countdownTimer !== null) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    countdownSeconds = 0;
    updateReadyBanner(null);
    wizard?.setCountdown?.(null);
  }

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
    const centerY = isFiniteNumber(arena?.centerY) ? arena.centerY : 0;
    const centerZ = isFiniteNumber(arena?.centerZ) ? arena.centerZ : 0;

    const toWorld = card => ({
      x: centerX + (card.worldPosition[0] - centerX) * scale,
      y: Number.isFinite(card.worldPosition?.[1]) ? card.worldPosition[1] : centerY,
      z: centerZ + (card.worldPosition[2] - centerZ) * scale
    });

    const records = [];
    const index = factionIndex;
    const poseRot = new THREE.Matrix4();
    const typeCount = new Map();

    for (let i = 0; i < validatedCards.length; i++) {
      const card = validatedCards[i];
      const key = `${card.faction}-${card.type}`;
      const count = typeCount.get(key) || 0;
      typeCount.set(key, count + 1);
      const id = `${card.faction}-${card.type}-${count}`;
      const spot = toWorld(card);
      const isBase = UNIT_DEFINITIONS[card.type]?.role === 'base';

      if (isBase) {
        // 1. Base structure remains stationary and anchored on its card.
        const structure = systems.create(card.type, new THREE.Vector3(spot.x, spot.y, spot.z));
        structure.cardId = card.cardId;
        applyBattleVisualScale(structure);
        structure.build();

        if (Array.isArray(card.pose) && card.pose.length === 16 && card.pose.every(Number.isFinite)) {
          const yaw = card.faction === 'blue' ? Math.PI / 2 : -Math.PI / 2;
          structure.group.matrixAutoUpdate = false;
          structure.group.matrix.fromArray(card.pose)
            .multiply(poseRot.makeRotationX(Math.PI / 2))
            .multiply(poseRot.makeRotationY(yaw))
            .scale(new THREE.Vector3().setScalar(BATTLE_VISUAL_SCALE * PREVIEW_SCALE * structure.modelScale));
          structure.group.matrixWorldNeedsUpdate = true;
          structure.group.updateWorldMatrix(true, true);
        } else {
          structure.group.rotation.y = card.faction === 'blue' ? Math.PI / 2 : -Math.PI / 2;
        }
        structures.set(id, structure);

        hud.attach(id, structure.group, {
          type: card.type,
          title: UNIT_DEFINITIONS[card.type]?.title ?? card.type,
          faction: card.faction,
          height: battleHudHeight(structure.group, card.type),
          health: structure.health,
          maxHealth: structure.maxHealth
        });

        records.push({
          id,
          type: card.type,
          faction: card.faction,
          health: structure.health,
          maxHealth: structure.maxHealth,
          cooldown: 0,
          position: { x: spot.x, z: spot.z },
          targetId: null,
          alive: true
        });
      } else {
        // 2. Mobile combat unit: spawns directly at card and walks out into battle!
        const unit = createUnit(card.type, unitContext(), {
          position: new THREE.Vector3(spot.x, spot.y, spot.z),
          faction: card.faction,
          index: count,
          spawnOffset: new THREE.Vector3(spot.x, spot.y, spot.z)
        });
        applyBattleVisualScale(unit);
        unit.build();

        // The mobile unit marches out from its card into the battle arena
        const factionCards = validatedCards.filter(c => c.faction === card.faction);
        const cardIndexInFaction = factionCards.indexOf(card);
        const laneOffset = ((cardIndexInFaction % 3) - 1) * 0.85;
        const forwardRatio = UNIT_DEFINITIONS[card.type]?.role === 'prajurit' ? 0.6 : 0.4;
        const targetX = spot.x + (centerX - spot.x) * forwardRatio;
        const targetZ = spot.z + (centerZ - spot.z) * forwardRatio + laneOffset;
        unit.walkTo(targetX, targetZ);
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
      if (structure) {
        if (structure.state === 'built') structure.destroy();
        hud.detach(event.unitId);
        structures.delete(event.unitId);
      }
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
    const structure = structures.get(targetId);
    if (isFiniteNumber(structure?.maxHealth) && structure.maxHealth > 0) return structure.maxHealth;
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
      targetFiles: TARGET_FILES,
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
    if (Array.isArray(detections)) {
      for (const card of detections) {
        registerScannedCard(card);
      }
    }
    const currentList = getEffectiveCards();
    const reconciled = reconcileCards(currentList);
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
    const battleCheck = canStartBattle(reconciled);
    const result = validateTeams(reconciled);
    const isReady = battleCheck.canStart || result.valid;
    battlePreviews().setReady(isReady);
    const errors = battleCheck.canStart ? [] : (battleCheck.reason ? [battleCheck.reason] : result.errors);
    state.setCards(reconciled, { valid: isReady, errors, bySide: result.bySide });
    if (state.phase === 'scan') {
      screen()?.update?.({ cards: reconciled, errors, valid: isReady, countdown: countdownSeconds > 0 ? countdownSeconds : null });
    }

    if (isReady && state.phase === 'scan' && state.mode === 'battle') {
      startAutoCountdown();
    } else {
      cancelAutoCountdown();
    }
  }

  function beginBattle() {
    cancelAutoCountdown();
    if (disposed || state.phase !== 'scan') return false;
    const currentList = getEffectiveCards();
    const reconciled = reconcileCards(currentList);
    const check = canStartBattle(reconciled);
    const result = validateTeams(reconciled);
    if (!check.canStart && !result.valid) {
      const message = check.reason || result.errors[0] || 'Tim belum siap bertempur.';
      showToast(message);
      screen()?.update?.({ cards: reconciled, errors: [message], valid: false });
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
    cancelAutoCountdown();
    scannedCards.clear();
    clearBattlefield();
    clearPreviews();
    arenaMesh.apply(null);
    arena = null;
    formationActive = false;
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
    scannedCards.clear();
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
      onRescan() {
        cancelAutoCountdown();
        scannedCards.clear();
        clearPreviews();
        if (state.mode === 'test') return rescanTest();
        handleCards(tracking ? [...tracking.cards.values()] : []);
        showToast('Pemindaian diulang. Arahkan kamera ke kartu.');
      },
      onAction(action) { if (state.mode === 'test') return handleTestAction(action); },
      onBack() { if (state.mode === 'test') return backFromTest(); },
      onFormPosition() {
        formationActive = !formationActive;
        battlePreviews().setFormation(formationActive);
        showToast(formationActive ? 'Unit berbaris di posisi formasi di depan garis.' : 'Unit kembali ke atas kartu.');
      }
    },
    onSelectMode(mode) {
      if (state.mode === mode) return;
      cancelAutoCountdown();
      scannedCards.clear();
      clearPreviews();
      state.setMode(mode);
      showToast(`Mode diubah ke: ${mode === 'battle' ? 'Mode Battle' : 'Mode Test'}`);
      if (state.phase === 'scan') {
        wizard?.render(state.phase);
        handleCards(tracking ? [...tracking.cards.values()] : []);
      }
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

  function syncCameraWithAR() {
    const arCam = tracking?.arCamera;
    if (arCam && arCam.projectionMatrix) {
      if (Number.isFinite(arCam.fov)) camera.fov = arCam.fov;
      if (Number.isFinite(arCam.near)) camera.near = arCam.near;
      if (Number.isFinite(arCam.far)) camera.far = arCam.far;
      if (Number.isFinite(arCam.aspect)) camera.aspect = arCam.aspect;
      camera.projectionMatrix.copy(arCam.projectionMatrix);
      if (arCam.projectionMatrixInverse && camera.projectionMatrixInverse) {
        camera.projectionMatrixInverse.copy(arCam.projectionMatrixInverse);
      }
      camera.position.set(0, 0, 0);
      camera.quaternion.set(0, 0, 0, 1);
      camera.scale.set(1, 1, 1);
      camera.matrix.identity();
      camera.matrixWorld.identity();
      camera.matrixWorldInverse.identity();
    }
  }

  function updateBattleStructures() {
    if (!tracking?.cards || structures.size === 0) return;
    const rot = new THREE.Matrix4();
    for (const card of tracking.cards.values()) {
      if (!Array.isArray(card?.pose) || card.pose.length !== 16 || !card.pose.every(Number.isFinite)) continue;
      for (const [id, structure] of structures) {
        if (structure.cardId === card.cardId || (!structure.cardId && id.includes(`-${card.type}-`))) {
          const isBlue = id.startsWith('blue-');
          const yaw = isBlue ? Math.PI / 2 : -Math.PI / 2;
          structure.group.matrixAutoUpdate = false;
          structure.group.matrix.fromArray(card.pose)
            .multiply(rot.makeRotationX(Math.PI / 2))
            .multiply(rot.makeRotationY(yaw))
            .scale(new THREE.Vector3().setScalar(BATTLE_VISUAL_SCALE * PREVIEW_SCALE * structure.modelScale));
          structure.group.matrixWorldNeedsUpdate = true;
          structure.group.updateWorldMatrix(true, true);
          break;
        }
      }
    }
  }

  function updateFrame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const phase = state.phase;

    syncCameraWithAR();

    if (phase === 'scan' && tracking?.cards) {
      for (const card of tracking.cards.values()) {
        registerScannedCard(card);
      }
    }

    if (phase === 'scan' && state.mode === 'battle') {
      const currentList = getEffectiveCards();
      const reconciled = reconcileCards(currentList);
      battlePreviews().sync(reconciled);
      const battleCheck = canStartBattle(reconciled);
      battlePreviews().setReady(battleCheck.canStart);
    }
    systems.update(dt);
    updateUnits(dt);
    if (phase === 'scan' && state.mode === 'test') testModel.update(dt);

    if (phase === 'battle') updateBattleStructures();
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

  let resizeTimer = null;
  function onWindowResize() {
    if (typeof innerWidth !== 'undefined' && typeof innerHeight !== 'undefined') {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
      tracking?.resize?.();
      syncCameraWithAR();
    }
  }

  function handleWindowResize() {
    onWindowResize();
    if (typeof globalThis.requestAnimationFrame === 'function') {
      globalThis.requestAnimationFrame(onWindowResize);
    }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(onWindowResize, 150);
  }

  function start() {
    wizard = mountWizard(root, state, handlers);
    toast = createToast(root);
    running = true;
    if (typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener('resize', handleWindowResize);
      globalThis.addEventListener('orientationchange', handleWindowResize);
      if (globalThis.screen?.orientation?.addEventListener) {
        globalThis.screen.orientation.addEventListener('change', handleWindowResize);
      }
    }
    renderer.setAnimationLoop(updateFrame);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (typeof globalThis.removeEventListener === 'function') {
      globalThis.removeEventListener('resize', handleWindowResize);
      globalThis.removeEventListener('orientationchange', handleWindowResize);
      if (globalThis.screen?.orientation?.removeEventListener) {
        globalThis.screen.orientation.removeEventListener('change', handleWindowResize);
      }
    }
    clearTimeout(resizeTimer);
    unsubscribePreviews();
    testModel.dispose();
    if (running) {
      renderer.setAnimationLoop(null);
      running = false;
    }
    cancelAutoCountdown();
    if (readyBanner) {
      readyBanner.remove();
      readyBanner = null;
    }
    scannedCards.clear();
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







