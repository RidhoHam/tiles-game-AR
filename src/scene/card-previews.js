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
  }

  sync(cards) {
    const wanted = new Set();
    for (const card of cards) {
      if (!CARD_TARGETS.some(target => target.cardId === card.cardId && target.type === card.type)
        || !Array.isArray(card.pose) || card.pose.length !== 16 || !card.pose.every(Number.isFinite)) continue;
      wanted.add(card.cardId);
      let model = this.models.get(card.cardId);
      if (!model) {
        model = this.systems.create(card.type, new THREE.Vector3());
        try {
          model.build({ immediate: true });
          model.group.matrixAutoUpdate = false;
          this.scene.add(model.group);
          this.models.set(card.cardId, model);
        } catch (error) {
          model.dispose();
          throw error;
        }
      }
      // Marker XY is the printed face, +Z its outward normal. Model +Y is up.
      // M = pose * Rx(+pi/2) * Ry(factionYaw) * S(preview * modelScale).
      const yaw = card.side === 'blue' ? Math.PI / 2 : card.side === 'red' ? -Math.PI / 2 : 0;
      model.group.matrix.fromArray(card.pose)
        .multiply(this.rotation.makeRotationX(Math.PI / 2))
        .multiply(this.rotation.makeRotationY(yaw))
        .scale(new THREE.Vector3().setScalar(PREVIEW_SCALE * model.modelScale));
      model.group.matrixWorldNeedsUpdate = true;
    }
    for (const [id, model] of this.models) {
      if (wanted.has(id)) continue;
      model.dispose();
      this.models.delete(id);
    }
  }

  clear() {
    for (const model of this.models.values()) model.dispose();
    this.models.clear();
  }
}
