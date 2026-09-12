import * as THREE from 'three';
import { UNIT_DEFINITIONS } from '../core/unit-definitions.js';

const POSE_CORRECTION = new THREE.Matrix4().makeRotationX(Math.PI / 2);
const ID = 'test-model';
const MIN_SCALE = 0.08;
const MAX_SCALE = 0.5;
const SCALE_STEP = 1.15;
const ROTATION_STEP = Math.PI / 12;

function validPose(pose) {
  return Array.isArray(pose) && pose.length === 16 && pose.every(Number.isFinite);
}

export class TestModelController {
  constructor({ systems, root, hud, effects } = {}) {
    this.systems = systems;
    this.root = root;
    this.hud = hud;
    this.effects = effects ?? systems?.effects;
    this._anchor = null;
    this._model = null;
    this._card = null;
    this._pose = new THREE.Matrix4();
    this._rotation = 0;
    this._scale = 1;
    this._disposed = false;
  }

  get model() { return this._model; }
  get card() { return this._card; }
  get scale() { return this._scale; }
  get available() { return Boolean(this._model && this._card); }

  sync(card = null) {
    if (this._disposed) return null;
    if (!card || !validPose(card.pose) || !UNIT_DEFINITIONS[card.type]) {
      this.clear();
      return null;
    }

    if (!this._model || this._card?.type !== card.type) {
      this.clear();
      this._model = this.systems.create(card.type, new THREE.Vector3());
      this._anchor = new THREE.Group();
      this._anchor.name = `${ID}:anchor`;
      (this.root ?? this._model.group.parent)?.add(this._anchor);
      this._anchor.add(this._model.group);
      this._anchor.matrixAutoUpdate = false;
      this._model.build({ immediate: true });
      this.hud?.attach?.(ID, this._model.group, {
        type: card.type,
        title: UNIT_DEFINITIONS[card.type].title,
        faction: null,
        health: this._model.health,
        maxHealth: this._model.maxHealth
      });
      this._rotation = 0;
      this._scale = 1;
    }

    this._card = card;
    this._pose.fromArray(card.pose);
    this._applyPose();
    return this._model;
  }

  _applyPose() {
    if (!this._model) return;
    const scale = new THREE.Vector3().setScalar(0.18 * this._model.modelScale * this._scale);
    this._anchor?.matrix.copy(this._pose)
      .multiply(POSE_CORRECTION)
      .multiply(new THREE.Matrix4().makeRotationY(this._rotation))
      .scale(scale);
    if (this._anchor) {
      // The anchor is pose-driven, so automatic local-matrix updates stay off.
      // Propagate the freshly written marker transform immediately so the model
      // and HUD see the current MindAR pose before the renderer draws the frame.
      this._anchor.matrixWorldNeedsUpdate = true;
      this._anchor.updateWorldMatrix(true, true);
    }
  }

  update(dt = 0) {
    if (!this._model) return;
    if (this._model.state === 'destroyed' || this._model.state === 'fallen') {
      this.effects?.clearOwner?.(this._model);
      this.clear();
      return;
    }
    // SandStructureSystem owns structure updates. The production frame loop
    // calls systems.update(dt) before this method, so advancing the model here
    // too would make Test Mode animations and lifecycle timers run twice.
    this._applyPose();
  }

  clear() {
    this.effects?.clearOwner?.(this._model);
    this.hud?.detach?.(ID);
    this._model?.dispose?.();
    this._anchor?.parent?.remove(this._anchor);
    this._anchor = null;
    this._model = null;
    this._card = null;
    this._rotation = 0;
    this._scale = 1;
  }

  perform(action) {
    if (!this.available) return { ok: false, message: 'Tidak ada model yang dapat diuji.' };
    const model = this._model;
    let changed;
    if (action === 'reset') {
      changed = model.build({ immediate: true });
      this._rotation = 0;
      this._scale = 1;
    } else if (action === 'build') {
      changed = model.build();
    } else if (action === 'action') {
      changed = model.act();
    } else if (action === 'damage') {
      if (!Number.isFinite(model.health) || model.health <= 1) {
        return { ok: false, message: 'Model sudah terlalu rusak untuk menerima damage.' };
      }
      changed = model.damage(Math.min(10, model.health - 1));
      this.hud?.setHealth?.(ID, model.health, model.maxHealth);
    } else if (action === 'destroy') {
      changed = model.destroy();
    } else if (action === 'rotate-left') {
      this._rotation -= ROTATION_STEP;
    } else if (action === 'rotate-right') {
      this._rotation += ROTATION_STEP;
    } else if (action === 'scale-up') {
      this._scale = Math.min(MAX_SCALE, this._scale * SCALE_STEP);
    } else if (action === 'scale-down') {
      this._scale = Math.max(MIN_SCALE, this._scale / SCALE_STEP);
    } else {
      return { ok: false, message: 'Aksi model tidak dikenal.' };
    }
    if (changed !== false && (action === 'reset' || action === 'build')) {
      this.hud?.setHealth?.(ID, model.health, model.maxHealth);
    }
    this._applyPose();
    if (changed === false) return { ok: false, message: `Aksi ${action} tidak dapat dilakukan pada status model saat ini.` };
    if (action === 'destroy') {
      this.hud?.setHealth?.(ID, model.health, model.maxHealth);
      this.effects?.clearOwner?.(model);
    }
    return { ok: true, message: `${action} berhasil.` };
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.clear();
  }
}
