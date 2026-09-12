import * as T from 'three';

const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

// Effect presets. These are only defaults; `burst` keeps its original
// signature and behaviour, so every existing caller is untouched.
const MATERIALISE_COUNT = 16; // sand puff while a unit assembles / materialises
const IMPACT_COUNT = 5;       // small hit spark on a struck target
const COLLAPSE_COUNT = 22;    // full sand collapse when a unit or base falls

export class SandEffects {
  constructor(scene, material, capacity) {
    this.scene = scene;
    this.capacity = capacity;
    this.items = Array.from({ length: capacity }, () => ({ age: 2, life: 1, p: new T.Vector3(), v: new T.Vector3(), size: 0, owner: null }));
    this.cursor = 0;
    this.dummy = new T.Object3D();
    this.mesh = new T.InstancedMesh(new T.IcosahedronGeometry(1, 0), material, capacity);
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.scene.add(this.mesh);
    this.update(0);
  }
  burst(position, count, construction, owner = null) {
    for (let i = 0; i < count; i++) {
      const item = this.items[this.cursor++ % this.capacity];
      item.age = 0;
      item.life = 0.65 + Math.random() * 0.8;
      item.size = 0.025 + Math.random() * (construction ? 0.035 : 0.13);
      item.p.copy(position);
      item.p.x += (Math.random() - 0.5) * 0.8;
      item.p.z += (Math.random() - 0.5) * 0.8;
      item.p.y += construction ? 1 + Math.random() : 0;
      item.v.set((Math.random()-0.5)*3, construction ? -1 : 2+Math.random()*3, (Math.random()-0.5)*3);
      item.owner = owner;
    }
  }
  clearOwner(owner) {
    if (owner == null) return;
    for (const item of this.items) {
      if (item.owner !== owner) continue;
      item.age = item.life;
      item.owner = null;
      item.size = 0;
    }
  }
  // --- Thin named presets over burst() --------------------------------------
  //
  // Each helper is a one-line wrapper that picks the particle count and the
  // "construction" flag. They exist so the controller reads as the battle it is
  // describing instead of repeating magic numbers, and so the tuning lives in
  // ONE place. They add no particle system and no state: a missing/thin
  // `effects` object is the caller's problem, not theirs.

  /** Sand puff as a unit materialises out of its card. */
  unitMaterialise(position) { if (position) this.burst(position, MATERIALISE_COUNT, true); }

  /** Small hit puff where a strike lands on a target. */
  unitHit(position) { if (position) this.burst(position, IMPACT_COUNT, false); }

  /** Full sand collapse when a unit or base is destroyed. */
  unitCollapse(position) { if (position) this.burst(position, COLLAPSE_COUNT, false); }

  update(dt) {
    for (let i = 0; i < this.capacity; i++) {
      const item = this.items[i];
      item.age += dt;
      if (item.age < item.life) {
        item.v.y -= 9.8 * dt;
        item.p.addScaledVector(item.v, dt);
        if (item.p.y < item.size) { item.p.y = item.size; item.v.set(0, 0, 0); }
        this.dummy.position.copy(item.p);
        this.dummy.rotation.set(item.age*3, i, item.age);
        this.dummy.scale.setScalar(item.size * (1-smooth((item.age/item.life-0.65)/0.35)));
      } else this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose() { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
}
