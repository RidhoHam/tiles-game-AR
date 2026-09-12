import * as T from 'three';

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const dimension = n => Number.isFinite(n) ? Math.max(0, n) : 0;
const count = n => Math.floor(dimension(n));
const smooth = n => { n = clamp(n, 0, 1); return n * n * (3 - 2 * n); };

function random(seed) {
  let state = Number.isFinite(seed) ? seed >>> 0 : 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function createGrainSampler() {
  function sampleBox(size, amount, seed) {
    const rng = random(seed);
    const [x, y, z] = [0, 1, 2].map(i => dimension(size[i]) / 2);
    return Array.from({ length: count(amount) }, () =>
      new T.Vector3((rng() * 2 - 1) * x, (rng() * 2 - 1) * y, (rng() * 2 - 1) * z));
  }
  function sampleCylinder(top, bottom, height, amount, seed) {
    const rng = random(seed);
    top = dimension(top); bottom = dimension(bottom); height = dimension(height);
    const radius = Math.max(top, bottom);
    return Array.from({ length: count(amount) }, () => {
      let t, x, z, localRadius;
      do {
        t = rng(); x = (rng() * 2 - 1) * radius; z = (rng() * 2 - 1) * radius;
        localRadius = bottom + (top - bottom) * t;
      } while (x * x + z * z > localRadius * localRadius);
      return new T.Vector3(x, (t - 0.5) * height, z);
    });
  }
  function sampleSphere(amount, seed) {
    const rng = random(seed);
    return Array.from({ length: count(amount) }, () => {
      const point = new T.Vector3();
      do { point.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1); }
      while (point.lengthSq() > 1);
      return point;
    });
  }
  function sampleExtrusion(shape, depth, amount, seed) {
    const rng = random(seed);
    const shapes = Array.isArray(shape) ? shape : [shape];
    const triangles = [];
    let area = 0;
    for (const outline of shapes) {
      const extracted = outline.extractPoints(16);
      const contour = extracted.shape.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
      const holes = extracted.holes.map(hole => hole.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
      if (contour.length < 3) continue;
      // Triangulation preserves concavities and holes, without unbounded rejection for thin shapes.
      const faces = T.ShapeUtils.triangulateShape(contour, holes);
      const vertices = contour.concat(...holes);
      for (const face of faces) {
        const [a, b, c] = face.map(i => vertices[i]);
        const weight = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
        if (!Number.isFinite(weight) || weight <= 0) continue;
        area += weight;
        triangles.push({ a, b, c, area });
      }
    }
    if (!triangles.length) return Array.from({ length: count(amount) }, () => new T.Vector3());
    return Array.from({ length: count(amount) }, () => {
      const choice = rng() * area;
      const triangle = triangles.find(t => choice < t.area) || triangles[triangles.length - 1];
      const u = Math.sqrt(rng()), v = rng();
      return new T.Vector3(
        (1 - u) * triangle.a.x + u * (1 - v) * triangle.b.x + u * v * triangle.c.x,
        (1 - u) * triangle.a.y + u * (1 - v) * triangle.b.y + u * v * triangle.c.y,
        rng() * dimension(depth));
    });
  }
  function samplePart(part, amount, seed) {
    const geometry = part.mesh.geometry, p = geometry.parameters;
    switch (geometry.type) {
      case 'BoxGeometry': return sampleBox([p.width, p.height, p.depth], amount, seed);
      case 'ConeGeometry': return sampleCylinder(0, p.radius, p.height, amount, seed);
      case 'CylinderGeometry': return sampleCylinder(p.radiusTop, p.radiusBottom, p.height, amount, seed);
      case 'SphereGeometry': return sampleSphere(amount, seed).map(point => point.multiplyScalar(dimension(p.radius)));
      case 'ExtrudeGeometry': return sampleExtrusion(p.shapes, p.options.depth ?? 1, amount, seed);
      default: throw new Error(`Unsupported grain geometry: ${geometry.type}`);
    }
  }
  return { sampleBox, sampleCylinder, sampleSphere, sampleExtrusion, samplePart };
}

export function createGrainPool(capacity) {
  capacity = count(capacity);
  const free = Array.from({ length: capacity }, (_, i) => capacity - 1 - i);
  const owners = new Map();
  return {
    capacity,
    get activeCount() { return capacity - free.length; },
    get available() { return free.length; },
    acquire(owner, amount) {
      if (!Number.isInteger(amount) || amount <= 0 || amount > free.length) return [];
      let owned = owners.get(owner);
      if (!owned) { owned = new Set(); owners.set(owner, owned); }
      const slots = Array.from({ length: amount }, () => free.pop());
      for (const slot of slots) owned.add(slot);
      return slots;
    },
    release(owner, slots) {
      const owned = owners.get(owner);
      if (!owned) return;
      for (const slot of slots) if (owned.delete(slot)) free.push(slot);
      if (!owned.size) owners.delete(owner);
    },
    clearOwner(owner) {
      const owned = owners.get(owner);
      if (owned) { for (const slot of owned) free.push(slot); owners.delete(owner); }
    },
  };
}

function revealMaterial(material, reveal) {
  const compile = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = function(shader, renderer) {
    compile.call(this, shader, renderer);
    shader.uniforms.sandReveal = reveal;
    shader.fragmentShader = 'uniform float sandReveal;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `
      #include <alphatest_fragment>
      float sandDither = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
      if (sandReveal <= sandDither) discard;
    `);
  };
  material.customProgramCacheKey = () => key + '-grain-reveal';
  return material;
}

export class SandGrainSystem {
  constructor(scene, material, options = {}) {
    this.scene = scene;
    this.pool = createGrainPool(options.grainCapacity ?? 40000);
    this.owners = new Map();
    this.sampler = createGrainSampler();
    this.material = material.clone();
    this.material.onBeforeCompile = material.onBeforeCompile;
    this.material.customProgramCacheKey = material.customProgramCacheKey;
    this.mesh = new T.InstancedMesh(new T.IcosahedronGeometry(1, 0), this.material, this.pool.capacity);
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.dummy = new T.Object3D();
    this.hidden = new T.Matrix4().makeScale(0, 0, 0);
    this.inverseRoot = new T.Matrix4();
    this.matrix = new T.Matrix4();
    this.point = new T.Vector3();
    this.target = new T.Vector3();
    this.dirty = false;
    for (let i = 0; i < this.pool.capacity; i++) this.mesh.setMatrixAt(i, this.hidden);
    scene.add(this.mesh);
  }
  registerPart(owner, part) {
    let records = this.owners.get(owner);
    if (!records) { records = []; this.owners.set(owner, records); }
    if (records.some(record => record.part === part)) return;
    const mesh = part.mesh;
    mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox.getSize(new T.Vector3()).multiply(part.scale);
    const volume = Math.abs(size.x * size.y * size.z);
    const amount = clamp(Math.round(volume * 120), 24, 1400);
    part.grainSeed = part.grainSeed ?? records.length + 17;
    part.grainTarget = this.sampler.samplePart(part, amount, part.grainSeed);
    part.grainSlots = [];
    part.grainProgress = 0;
    part.grainTransition = null;
    part.grainReveal = { value: 0 };
    const original = { material: mesh.material, depth: mesh.customDepthMaterial, distance: mesh.customDistanceMaterial };
    const solid = mesh.material.clone();
    solid.onBeforeCompile = mesh.material.onBeforeCompile;
    solid.customProgramCacheKey = mesh.material.customProgramCacheKey;
    mesh.material = revealMaterial(solid, part.grainReveal);
    mesh.customDepthMaterial = revealMaterial(new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking }), part.grainReveal);
    mesh.customDistanceMaterial = revealMaterial(new T.MeshDistanceMaterial(), part.grainReveal);
    const rng = random(part.grainSeed + 1000);
    records.push({
      part, original, mode: null, age: 0, delay: 0, ground: 0,
      pose: new T.Matrix4(),
      size: clamp(Math.cbrt(volume / amount) * 0.38, 0.018, 0.085),
      source: part.grainTarget.map(() => new T.Vector3()),
      position: part.grainTarget.map(() => new T.Vector3()),
      velocity: part.grainTarget.map(() => new T.Vector3()),
      offsets: part.grainTarget.map(() => new T.Vector3(rng() * 2 - 1, rng(), rng() * 2 - 1)),
    });
  }
  capture(owner, record) {
    this.scene.updateWorldMatrix(true, true);
    this.inverseRoot.copy(this.scene.matrixWorld).invert();
    record.pose.multiplyMatrices(this.inverseRoot, record.part.mesh.matrixWorld);
    this.matrix.multiplyMatrices(this.inverseRoot, owner.group.matrixWorld);
    record.ground = this.matrix.elements[13];
    for (let i = 0; i < record.part.grainTarget.length; i++) {
      const offset = record.offsets[i];
      record.position[i].copy(record.part.grainTarget[i]).applyMatrix4(record.pose);
      record.source[i].set(record.position[i].x + offset.x * 1.8,
        record.ground + 0.03 + offset.y * 0.12, record.position[i].z + offset.z * 1.8);
      record.velocity[i].set(offset.x * 2.2, 0.6 + offset.y * 2.4, offset.z * 2.2);
    }
  }
  startBuild(owner) {
    const records = this.owners.get(owner);
    if (!records || records.some(record => record.mode === 'build')) return false;
    this.clearOwner(owner);
    const activeRecordCount = [...this.owners.values()].reduce((sum, ownerRecords) => sum + ownerRecords.length, 0);
    const timedFallback = this.pool.capacity < activeRecordCount;
    for (const record of records) {
      this.capture(owner, record);
      record.mode = 'build'; record.age = 0; record.delay = record.part.delay; record.timedFallback = timedFallback;
      record.part.grainTransition = 'build'; record.part.grainProgress = 0;
      record.part.grainReveal.value = 0; record.part.mesh.visible = false;
    }
    return true;
  }
  startDestroy(owner, part, delay = 0) {
    const record = this.owners.get(owner)?.find(record => record.part === part);
    if (!record || part.dead || record.mode) return false;
    this.capture(owner, record);
    record.mode = 'destroy'; record.age = 0; record.delay = dimension(delay);
    const activeRecordCount = [...this.owners.values()].reduce((sum, records) => sum + records.length, 0);
    record.timedFallback = this.pool.capacity < activeRecordCount;
    part.grainTransition = 'destroy'; part.grainProgress = 0;
    return true;
  }
  isActive(owner) { return this.owners.get(owner)?.some(record => record.mode !== null) ?? false; }
  release(owner, record) {
    for (const slot of record.part.grainSlots) this.mesh.setMatrixAt(slot, this.hidden);
    if (record.part.grainSlots.length) this.dirty = true;
    this.pool.release(owner, record.part.grainSlots);
    record.part.grainSlots = [];
    record.part.grainTransition = null;
    record.mode = null;
  }
  update(dt) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    this.scene.updateWorldMatrix(true, true);
    this.inverseRoot.copy(this.scene.matrixWorld).invert();
    for (const [owner, records] of this.owners) for (const record of records) {
      if (!record.mode) continue;
      const part = record.part;
      if (record.timedFallback) {
        record.age += dt;
        const age = Math.max(0, record.age - record.delay);
        const progress = clamp(age / (record.mode === 'build' ? 3.2 : 3.1), 0, 1);
        part.grainProgress = progress;
        part.grainReveal.value = record.mode === 'build' ? smooth((progress - 0.72) / 0.2) : 1 - smooth(age / 0.3);
        part.mesh.visible = record.mode === 'build' ? progress >= 0.72 : age < 0.3;
        if (progress === 1) this.release(owner, record);
        continue;
      }
      // Queued parts remain lifecycle work until capacity is available. Zero capacity uses a timed reveal.
      if (!part.grainSlots.length && this.pool.capacity) {
        if (!this.pool.available) continue;
        part.grainSlots = this.pool.acquire(owner, Math.min(part.grainTarget.length, this.pool.available));
      }
      record.age += dt;
      const age = record.age - record.delay;
      if (age < 0) continue;
      const building = record.mode === 'build';
      const duration = building ? 3.2 : 3.1;
      const progress = clamp(age / duration, 0, 1);
      part.grainProgress = progress;
      part.grainReveal.value = building ? smooth((progress - 0.72) / 0.2) : 1 - smooth(age / 0.3);
      part.mesh.visible = building ? progress >= 0.72 : age < 0.3;
      if (building) this.matrix.multiplyMatrices(this.inverseRoot, part.mesh.matrixWorld);
      for (let i = 0; i < part.grainSlots.length; i++) {
        const offset = record.offsets[i];
        let fade;
        if (building) {
          const travel = smooth((progress - offset.y * 0.13) / 0.55);
          this.target.copy(part.grainTarget[i]).applyMatrix4(this.matrix);
          this.point.lerpVectors(record.source[i], this.target, travel);
          this.point.y += Math.sin(travel * Math.PI) * (0.8 + offset.y);
          this.point.x += Math.sin(travel * Math.PI) * offset.z * 0.5;
          fade = smooth(progress / 0.12) * (1 - smooth((progress - 0.82) / 0.18));
        } else {
          const position = record.position[i], velocity = record.velocity[i];
          velocity.y -= 9.8 * dt;
          position.addScaledVector(velocity, dt);
          if (position.y < record.ground + record.size) {
            position.y = record.ground + record.size;
            velocity.y = Math.abs(velocity.y) > 0.45 ? Math.abs(velocity.y) * 0.22 : 0;
            velocity.x *= Math.exp(-dt * 12); velocity.z *= Math.exp(-dt * 12);
          }
          this.point.copy(position);
          fade = 1 - smooth((progress - 0.68) / 0.32);
        }
        this.dummy.position.copy(this.point);
        this.dummy.rotation.set(offset.x * 3 + age, offset.y * 6, offset.z * 3);
        this.dummy.scale.setScalar(record.size * (0.7 + offset.y * 0.6) * fade);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(part.grainSlots[i], this.dummy.matrix);
        this.dirty = true;
      }
      if (progress === 1) this.release(owner, record);
    }
    this.mesh.visible = this.pool.activeCount > 0;
    if (this.dirty) { this.mesh.instanceMatrix.needsUpdate = true; this.dirty = false; }
  }
  clearOwner(owner) {
    for (const record of this.owners.get(owner) || []) this.release(owner, record);
    this.pool.clearOwner(owner);
    this.mesh.visible = this.pool.activeCount > 0;
  }
  unregisterOwner(owner) {
    this.clearOwner(owner);
    for (const { part, original } of this.owners.get(owner) || []) {
      part.mesh.material.dispose(); part.mesh.customDepthMaterial.dispose(); part.mesh.customDistanceMaterial.dispose();
      part.mesh.material = original.material;
      part.mesh.customDepthMaterial = original.depth; part.mesh.customDistanceMaterial = original.distance;
      part.grainTarget = [];
    }
    this.owners.delete(owner);
  }
  dispose() {
    for (const owner of this.owners.keys()) this.unregisterOwner(owner);
    this.scene.remove(this.mesh);
    this.mesh.dispose(); this.mesh.geometry.dispose(); this.material.dispose();
  }
}
