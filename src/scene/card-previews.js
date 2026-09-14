import * as THREE from 'three';
import { CARD_TARGETS } from '../ar/card-targets.js';

// Multiplier of the existing modelScale: previews target roughly 1.5-2 card
// widths so they remain readable while staying independent of card count.
export const PREVIEW_SCALE = 0.18;

export class CardPreviews {
  constructor(systems, scene) {
    this.systems = systems;
    this.scene = scene;
    this.models = new Map();
    this.rotation = new THREE.Matrix4();
    this.inFormation = false;
    this.isReady = false;
    this.lastCards = [];
  }

  setFormation(inFormation) {
    this.inFormation = Boolean(inFormation);
    if (this.lastCards.length > 0) {
      this.sync(this.lastCards);
    }
  }

  setReady(isReady) {
    this.isReady = Boolean(isReady);
    for (const model of this.models.values()) {
      if (model.projectionRing?.material) {
        const ringColor = this.isReady ? 0x22c55e : (model.side === 'blue' ? 0x38bdf8 : 0xf87171);
        model.projectionRing.material.color.setHex(ringColor);
        model.projectionRing.material.opacity = this.isReady ? 0.95 : 0.75;
      }
    }
  }

  sync(cards) {
    this.lastCards = cards ?? [];
    const wanted = new Set();
    let cardIdx = 0;
    for (const card of this.lastCards) {
      if (!CARD_TARGETS.some(target => target.cardId === card.cardId && target.type === card.type)
        || !Array.isArray(card.pose) || card.pose.length !== 16 || !card.pose.every(Number.isFinite)) continue;
      wanted.add(card.cardId);
      cardIdx++;
      let model = this.models.get(card.cardId);
      if (!model) {
        model = this.systems.create(card.type, new THREE.Vector3());
        try {
          model.build({ immediate: true });
          model.group.matrixAutoUpdate = false;
          model.side = card.side;

          // Projection pedestal ring indicating model is projected and locked to the card
          const ringGeo = new THREE.RingGeometry(0.85, 1.05, 32);
          ringGeo.rotateX(-Math.PI / 2);
          const ringColor = this.isReady ? 0x22c55e : (card.side === 'blue' ? 0x38bdf8 : 0xf87171);
          const ringMat = new THREE.MeshBasicMaterial({
            color: ringColor,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: this.isReady ? 0.95 : 0.75
          });
          const ring = new THREE.Mesh(ringGeo, ringMat);
          ring.position.y = 0.02;
          model.projectionRing = ring;
          model.group.add(ring);

          this.scene.add(model.group);
          this.models.set(card.cardId, model);
        } catch (error) {
          model.dispose();
          throw error;
        }
      }
      model.side = card.side;
      if (model.projectionRing?.material) {
        const ringColor = this.isReady ? 0x22c55e : (card.side === 'blue' ? 0x38bdf8 : 0xf87171);
        model.projectionRing.material.color.setHex(ringColor);
      }

      // Marker XY is the printed face, +Z its outward normal. Model +Y is up.
      // M = pose * Rx(+pi/2) * Ry(factionYaw) * S(preview * modelScale).
      const yaw = card.side === 'blue' ? Math.PI / 2 : card.side === 'red' ? -Math.PI / 2 : 0;
      const isBase = card.type === 'benteng' || card.type === 'bunker';

      model.group.matrix.fromArray(card.pose)
        .multiply(this.rotation.makeRotationX(Math.PI / 2))
        .multiply(this.rotation.makeRotationY(yaw));

      if (this.inFormation && !isBase) {
        const forwardOffset = card.side === 'blue' ? 0.35 : -0.35;
        const laneOffset = ((cardIdx % 3) - 1) * 0.18;
        model.group.matrix.multiply(new THREE.Matrix4().makeTranslation(laneOffset, 0, forwardOffset));
      }

      model.group.matrix.scale(new THREE.Vector3().setScalar(PREVIEW_SCALE * model.modelScale));
      model.group.matrixWorldNeedsUpdate = true;
      model.group.updateWorldMatrix(true, true);
    }
    for (const [id, model] of this.models) {
      if (wanted.has(id)) continue;
      this._disposeModel(model);
      this.models.delete(id);
    }
  }

  _disposeModel(model) {
    if (model.projectionRing) {
      model.group.remove(model.projectionRing);
      model.projectionRing.geometry?.dispose?.();
      model.projectionRing.material?.dispose?.();
      model.projectionRing = null;
    }
    model.dispose();
  }

  clear() {
    for (const model of this.models.values()) this._disposeModel(model);
    this.models.clear();
  }
}
