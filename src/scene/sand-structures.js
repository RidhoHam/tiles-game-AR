/* Closed solids, shared wet-sand materials, and bounded instanced effects. */
import * as T from 'three';
import { SandGrainSystem } from './sand-grains.js';
import { SandEffects } from './sand-effects.js';

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const UP = new T.Vector3(0, 1, 0);

  function makeMaterial(blocks) {
    const material = new T.MeshStandardMaterial({ color: 0xc7bc94, roughness: 0.87, metalness: 0 });
    material.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec3 vSandPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvSandPosition = position;');
      shader.fragmentShader = 'varying vec3 vSandPosition;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        vec3 p = vSandPosition;
        float fine = fract(sin(dot(floor(p * 95.0), vec3(12.9898,78.233,37.719))) * 43758.5453);
        float coarse = sin(p.x*9.0 + sin(p.z*7.0)) * sin(p.y*12.0+p.z*5.0);
        diffuseColor.rgb *= 0.96 + coarse*0.045 + (fine-0.5)*0.13;
        diffuseColor.rgb *= mix(1.0, 0.78, smoothstep(0.86, 0.94, fine));
        ${blocks ? `
        float row = floor(p.y / 0.48);
        vec2 brick = vec2((p.x+p.z) / 0.82 + mod(row,2.0)*0.5, p.y/0.48);
        vec2 edge = min(fract(brick), 1.0-fract(brick));
        float mortar = 1.0 - smoothstep(0.008,0.035,min(edge.x,edge.y));
        diffuseColor.rgb *= 1.0 - mortar*0.25;
        ` : ''}
      `);
    };
    material.customProgramCacheKey = () => 'wet-sand-' + blocks;
    return material;
  }

  class SandStructure {
    constructor(system, type, title, description, position) {
      this.system = system;
      this.type = type;
      this.title = title;
      this.desc = description;
      this.group = new T.Group();
      this.group.position.copy(position);
      this.home = position.clone();
      this.parts = [];
      this.joints = [];
      this.state = 'idle';
      this.elapsed = 0;
      this.actionTime = 0;
      this.actionActive = false;
      this.health = 100;
      this.maxHealth = 100;
      this.aimYaw = 0; this.aimElevation = Math.PI / 6;
      this.weapons = []; this.volley = null;
      this.aimDirection = new T.Vector3(); this.aimRotation = new T.Quaternion();
      this.modelScale = type === 'benteng' || type === 'bunker' ? 1.5 : 1;
       this.actionLabel = { benteng: 'Buka / tutup', bunker: 'Tembak duri', robot: 'Menyerah', tank: 'Jalan / berhenti', kesatria: 'Tebas', gargoyle: 'Menukik' }[type];
      system.scene.add(this.group);
    }
    add(mesh, parent) {
      (parent || this.group).add(mesh);
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      mesh.castShadow = mesh.geometry.boundingSphere.radius * Math.max(mesh.scale.x, mesh.scale.y, mesh.scale.z) > 0.48;
      mesh.receiveShadow = true;
      const part = { mesh, home: mesh.position.clone(), rotation: mesh.quaternion.clone(), scale: mesh.scale.clone(), dead: false, falling: false, age: 0, delay: 0, v: new T.Vector3(), cosmetic: mesh.userData.cosmetic === true,
        grainTarget: [], grainSlots: [], grainProgress: 0, grainSeed: this.parts.length + 17, grainTransition: null,
        debrisPosition: new T.Vector3(), debrisOffset: new T.Vector3(), debrisInverse: new T.Matrix4() };
      this.parts.push(part);
      return mesh;
    }
    joint(position) {
      const group = new T.Group(); group.position.copy(position); this.group.add(group);
      this.joints.push(group); return group;
    }
    finish() {
      this.joints.forEach(j => { j.userData.homeRotation = j.quaternion.clone(); });
      this.system.scene.updateWorldMatrix(true, true);
      const local = new T.Vector3();
      const inverseRoot = this.system.scene.matrixWorld.clone().invert();
      this.parts.forEach(part => {
        local.setFromMatrixPosition(part.mesh.matrixWorld).applyMatrix4(inverseRoot);
        part.delay = Math.max(0, local.y-this.home.y) * 0.14;
        part.mesh.visible = false;
        this.system.grains.registerPart(this, part);
      });
      this.duration = Math.max(...this.parts.map(p => p.delay)) + 0.85;
      return this;
    }
    resetPose() {
      this.aimYaw = 0; this.aimElevation = Math.PI / 6; this.volley = null;
      this.group.position.copy(this.home); this.group.rotation.set(0, 0, 0);
      this.joints.forEach(j => j.quaternion.copy(j.userData.homeRotation));
      this.actionActive = false; this.actionTime = 0;
      for (const weapon of this.weapons) {
        weapon.pivot.quaternion.copy(weapon.homeRotation);
        weapon.recoil = 0; weapon.slide.position.y = 0; weapon.guide.visible = false;
      }
      if (this.bridge) this.bridge.rotation.x = -Math.PI/2;
    }
    aim(yaw, elevation) {
      if (!this.weapons.length || this.state !== 'built' || this.health < 100 || this.volley || !Number.isFinite(yaw) || !Number.isFinite(elevation)) return false;
      this.aimYaw = clamp(yaw, -Math.PI, Math.PI);
      this.aimElevation = clamp(elevation, Math.PI / 18, Math.PI * 5 / 12);
      return true;
    }
    fireVolley() {
      if (!this.weapons.length || this.state !== 'built' || this.health < 100 || this.volley) return false;
      this.volley = { next: 0, elapsed: 0 };
      return true;
    }
    build({ immediate = false } = {}) {
      if (this.state === 'building' || this.state === 'destroying') return false;
      this.system.clearProjectiles(this);
      this.resetPose(); this.state = 'building'; this.elapsed = 0; this.health = 100;
      this.parts.forEach(p => {
        p.dead = p.falling = false; p.age = 0; p.emitted = false;
        p.mesh.position.copy(p.home); p.mesh.quaternion.copy(p.rotation);
        p.mesh.scale.copy(p.scale); p.mesh.visible = false;
      });
      if (immediate) {
        // Scan previews must be visible on the first tracked frame, with no
        // arena-space grain plume or delayed dither reveal.
        this.system.grains.clearOwner(this);
        this.parts.forEach(p => { p.mesh.visible = true; p.grainReveal.value = 1; });
        this.state = 'built';
        return true;
      }
      return this.system.grains.startBuild(this);
    }
    collapse(part, delay) {
      if (part.dead) return;
      this.system.grains.startDestroy(this, part, delay);
      this.system.scene.updateWorldMatrix(true, true);
      part.debrisPosition.copy(this.system.scene.worldToLocal(part.mesh.getWorldPosition(new T.Vector3())));
      part.debrisOffset.set(0, 0, 0);
      part.dead = part.falling = true; part.age = -delay;
      part.v.set((Math.random()-0.5)*1.8, 0.5+Math.random(), (Math.random()-0.5)*1.8);
    }
    damage(amount, hitPoint) {
      if (this.state !== 'built' || !Number.isFinite(amount) || amount <= 0) return false;
      this.health = Math.max(0, this.health-amount);
      this.volley = null;
      this.weapons.forEach(w => { w.guide.visible = false; });
      if (this.health === 0) { this.destroy(); return true; }
      // Remove high exterior chunks first. Every remaining part is independently capped.
      const structural = this.parts.filter(p => !p.cosmetic);
       const target = Math.min(structural.length, Math.max(1, Math.ceil(structural.length * (1-this.health/100))));
      let count = structural.filter(p => p.dead).length;
      const candidates = structural.filter(p => !p.dead);
      if (hitPoint && [hitPoint.x, hitPoint.y, hitPoint.z].every(Number.isFinite)) {
        this.group.updateWorldMatrix(true, true);
        const bounds = new T.Box3();
        const center = new T.Vector3();
        for (const part of candidates) {
          bounds.setFromObject(part.mesh);
          part.mesh.getWorldPosition(center);
          // Prefer the actual struck mesh over a larger overlapping parent
          // volume; bounds distance alone makes every enclosing chunk tie at 0.
          part.hitDistance = bounds.containsPoint(hitPoint) ? center.distanceTo(hitPoint) * 0.01 : bounds.distanceToPoint(hitPoint) + center.distanceTo(hitPoint) * 0.01;
        }
        candidates.sort((a,b) => a.hitDistance-b.hitDistance || b.delay-a.delay);
      } else candidates.sort((a,b) => b.delay-a.delay);
      while (count < target && candidates.length) { this.collapse(candidates.shift(), 0); count++; }
      this.actionActive = false;
      return true;
    }
    destroy() {
      if (this.state !== 'built') return false;
      this.state = 'destroying'; this.elapsed = 0; this.health = 0; this.actionActive = false;
      this.volley = null;
      this.weapons.forEach(w => { w.guide.visible = false; });
      this.system.clearProjectiles(this);
      this.parts.forEach(p => this.collapse(p, Math.max(0, this.duration-p.delay-0.8)*0.35));
      return true;
    }
    act() {
      if (this.state !== 'built' || this.health < 100) return false;
      if (this.type === 'bunker') {
        return this.fireVolley();
      } else this.actionActive = !this.actionActive;
      return true;
    }
    fire() {
      if (this.type !== 'tank' || this.state !== 'built' || this.health < 100) return false;
      return this.system.fire(this, this.muzzle, 0);
    }
    update(dt) {
      this.elapsed += dt; this.actionTime += dt;
      const armed = this.state === 'built' && this.health === 100;
      if (!armed) this.volley = null;
      const direction = this.aimDirection.set(Math.sin(this.aimYaw)*Math.cos(this.aimElevation), Math.sin(this.aimElevation), Math.cos(this.aimYaw)*Math.cos(this.aimElevation));
      const targetAim = this.aimRotation.setFromUnitVectors(UP, direction);
      let aligned = true;
      for (const weapon of this.weapons) {
        weapon.guide.visible = armed;
        if (armed) weapon.pivot.quaternion.rotateTowards(targetAim, dt*3);
        aligned = aligned && weapon.pivot.quaternion.angleTo(targetAim)<0.01;
        weapon.recoil *= Math.exp(-dt*12);
        weapon.slide.position.y = -weapon.recoil;
      }
      if (this.volley && aligned) {
        const volley=this.volley; volley.elapsed+=dt;
        if (volley.elapsed>=volley.next*0.12) {
          const weapon=this.weapons[volley.next];
          if (this.system.fire(this,weapon.muzzle,0)) {
            weapon.recoil=this.type==='benteng'?0.18:0;
            weapon.slide.position.y = -weapon.recoil;
            const p=this.system.scene.worldToLocal(weapon.muzzle.getWorldPosition(new T.Vector3()));
            this.system.effects.burst(p,12,false,this);
          }
          volley.next++;
          if(volley.next>=this.weapons.length)this.volley=null;
        }
      }
      if (this.state === 'building') {
        if (!this.system.grains.isActive(this)) this.state = 'built';
      }
      if (this.state === 'built') {
        if (this.bridge) {
          const target = this.actionActive ? 0 : -Math.PI/2;
          this.bridge.rotation.x += (target-this.bridge.rotation.x)*(1-Math.exp(-dt*4));
        }
        if (this.type === 'robot' || this.type === 'kesatria') {
          const target = this.actionActive ? 2.7 : 0;
          if (this.arms) {
            this.arms[0].rotation.z += (target-this.arms[0].rotation.z)*(1-Math.exp(-dt*5));
            this.arms[1].rotation.z += (-target-this.arms[1].rotation.z)*(1-Math.exp(-dt*5));
          }
          if (this.head) this.head.rotation.x += ((this.actionActive ? 0.28 : 0)-this.head.rotation.x)*(1-Math.exp(-dt*3));
        }
        if (this.type === 'gargoyle') {
          this.group.position.y = this.home.y + 0.65 + Math.sin(this.actionTime * 3) * 0.12;
          if (this.wings) this.wings.forEach((wing, index) => { wing.rotation.z = (index ? -1 : 1) * (0.2 + Math.sin(this.actionTime * 8) * 0.38); });
        }
        if (this.type === 'tank' && this.actionActive) {
          this.group.position.z = this.home.z+Math.sin(this.actionTime*0.55)*2.2;
          this.wheels.forEach(w => { w.rotation.x = -this.group.position.z / 0.55; });
          this.treads.forEach((t,i) => {
            const a = i%20/20*Math.PI*2-this.group.position.z/2;
            t.position.y = 0.83+Math.cos(a)*0.7;
            t.position.z = Math.sin(a)*2.05;
            t.rotation.x = -a;
          });
        }
        if (this.type === 'bunker' && this.actionTime > 2.5) this.actionActive = false;
      }
      this.parts.forEach(p => {
        if (!p.falling) return;
        const before = p.age; p.age += dt;
        if (p.age < 0) return;
        if (before <= 0) {
          this.system.effects.burst(p.debrisPosition, 5, false, this);
        }
        p.v.y -= dt*5;
        p.debrisOffset.addScaledVector(p.v, dt);
        p.mesh.parent.updateWorldMatrix(true, false);
        p.debrisInverse.copy(p.mesh.parent.matrixWorld).invert().multiply(this.system.scene.matrixWorld);
        p.mesh.position.copy(p.debrisPosition).add(p.debrisOffset).applyMatrix4(p.debrisInverse);
        p.mesh.rotation.x += dt*0.7; p.mesh.rotation.z += dt*p.v.x;
        if (p.age >= 0.3) { p.mesh.visible = false; p.falling = false; }
      });
      if (this.state === 'destroying' && !this.parts.some(p => p.falling) && !this.system.grains.isActive(this)) this.state = 'destroyed';
    }
    getColliders() {
      this.group.updateWorldMatrix(true, true);
      return this.parts.filter(p => p.mesh.visible && !p.dead && !p.cosmetic).map(p => p.mesh);
    }
    dispose() {
      this.system.effects.clearOwner?.(this);
      this.weapons.forEach(w=>{w.guide.line.geometry.dispose();w.guide.line.material.dispose();w.guide.cone.geometry.dispose();w.guide.cone.material.dispose();});
      this.system.clearProjectiles(this);
      this.system.grains.unregisterOwner(this);
      this.group.removeFromParent();
      this.parts.forEach(p => p.mesh.geometry.dispose());
      const i = this.system.structures.indexOf(this);
      if (i >= 0) this.system.structures.splice(i, 1);
    }
  }

  class SandStructureSystem {
    constructor(scene, options) {
      this.scene = scene; this.options = options || {};
      this.material = makeMaterial(false); this.blocks = makeMaterial(true);
      this.dark = this.material.clone(); this.dark.color.setHex(0x8a805e);
      this.dark.onBeforeCompile = this.material.onBeforeCompile;
      this.structures = []; this.projectiles = [];
      this.effects = new SandEffects(scene, this.material, this.options.particleCapacity || 450);
      this.grains = new SandGrainSystem(scene, this.material, this.options);
      this.raycaster = new T.Raycaster();
      this.projectileGeometry = new T.ConeGeometry(0.16,0.55,6);
      this.cannonballGeometry = new T.IcosahedronGeometry(0.23,1);
    }
    mesh(geometry, position, blocks) {
      const mesh = new T.Mesh(geometry, blocks ? this.blocks : this.material);
      mesh.position.set(...position); return mesh;
    }
    box(s, size, p, blocks, parent) { return s.add(this.mesh(new T.BoxGeometry(...size), p, blocks), parent); }
    cylinder(s, top, bottom, height, p, blocks, parent) {
      return s.add(this.mesh(new T.CylinderGeometry(top,bottom,height,24,1,false),p,blocks),parent);
    }
    ball(s, size, p, parent) {
      const mesh = this.mesh(new T.SphereGeometry(1,20,12),p,false); mesh.scale.set(...size); return s.add(mesh,parent);
    }
    extrude(s, shape, depth, p, blocks, parent) {
      return s.add(this.mesh(new T.ExtrudeGeometry(shape,{ depth, bevelEnabled:false, curveSegments:16, steps:1 }),p,blocks),parent);
    }
    detailBox(s, size, p, parent, material) {
      const mesh = this.mesh(new T.BoxGeometry(...size), p, false);
      mesh.userData.cosmetic = true;
      if (material) mesh.material = material;
      return s.add(mesh, parent);
    }
    detailCylinder(s, radius, height, p, parent, material) {
      const mesh = this.mesh(new T.CylinderGeometry(radius, radius * 1.08, height, 12), p, false);
      mesh.userData.cosmetic = true;
      if (material) mesh.material = material;
      return s.add(mesh, parent);
    }
    weapon(s, pivot, muzzle, slide=pivot) {
      // Guides are visual-only and never enter structural health or grain sampling.
      const guide=new T.ArrowHelper(UP,new T.Vector3(0,muzzle.position.y,0),1.3,0x467e79,0.2,0.09);
      // ArrowHelper shares geometry globally; own these copies for safe disposal.
      guide.line.geometry = guide.line.geometry.clone();
      guide.cone.geometry = guide.cone.geometry.clone();
      guide.visible=false; slide.add(guide);
      s.weapons.push({pivot,muzzle,slide,guide,recoil:0,homeRotation:pivot.quaternion.clone()});
    }
    arrow(s, base, direction, length, parent) {
      const joint = new T.Group(); joint.position.copy(base);
      joint.quaternion.setFromUnitVectors(UP,direction.clone().normalize()); (parent || s.group).add(joint);
      this.cylinder(s,0.07,0.11,length,[0,length/2,0],false,joint);
      s.add(this.mesh(new T.ConeGeometry(0.26,0.65,5),[0,length+0.22,0],false),joint);
      return joint;
    }
    create(type, position) {
      // Task 1 renamed the domain unit types to Indonesian. Accept the new
      // canonical names; the English aliases below exist only for backward
      // compatibility with callers/tests written before the rename and can be
      // dropped once nothing passes them (see `tests/scene/sand-grains.test.js`).
      const ALIASES = { castle: 'benteng', knight: 'kesatria' };
      const name = ALIASES[type] || type;
      const labels = {
        benteng:['Benteng Pasir','Empat meriam menara, gerbang, dan jembatan angkat.'],
        bunker:['Bunker Berduri','Peluncur panah dengan arah bidik dan salvo bertahap.'],
        robot:['Robot Pasir','Penjaga pasir berarmor yang bisa mengangkat tangan.'],
         tank:['Tank Pasir','Rantai bergerak, turret berputar, dan meriam pasir.'],
         kesatria:['Kesatria Pasir','Reinforcement cepat dengan tebasan pasir.'],
         gargoyle:['Gargoyle Pasir','Reinforcement udara yang menukik dan mencakar.']
      };
      if (!labels[name]) throw new Error('Unknown sand structure: '+type);
      const s = new SandStructure(this,name,...labels[name],position || new T.Vector3());
       this[name](s); s.group.scale.setScalar(s.modelScale); s.finish(); this.structures.push(s); return s;
    }
    benteng(s) {
      // Filled keep, partitioned into capped horizontal chunks, with a shallow entrance recess.
      for (let y=0;y<6;y++) this.box(s,[4.9,0.51,3.5],[0,0.25+y*0.5,-0.35],true);
      this.box(s,[1.78,2.3,0.72],[-1.59,1.15,1.7],true);
      this.box(s,[1.78,2.3,0.72],[1.59,1.15,1.7],true);
      const arch = new T.Shape();
      arch.moveTo(-0.73,3); arch.lineTo(-0.73,1.38);
      arch.absarc(0,1.38,0.73,Math.PI,0,true);
      arch.lineTo(0.73,3); arch.closePath();
      this.extrude(s,arch,0.74,[0,0,1.34],true);
      this.box(s,[1.85,0.76,0.74],[-1.55,2.65,1.7],true);
      this.box(s,[1.85,0.76,0.74],[1.55,2.65,1.7],true);
      for (const x of [-2.4,2.4]) for (const z of [-1.85,1.85]) {
        for (let y=0;y<7;y++) this.cylinder(s,0.74,0.75,0.56,[x,0.27+y*0.54,z],true);
        this.cylinder(s,0.95,0.76,0.3,[x,3.85,z],true);
        for (let i=0;i<8;i++) {
          const a=i/8*Math.PI*2;
          const merlon=this.box(s,[0.42,0.42,0.37],[x+Math.cos(a)*0.73,4.16,z+Math.sin(a)*0.73],true);
          merlon.rotation.y=-a; s.parts[s.parts.length-1].rotation.copy(merlon.quaternion);
        }
        if (z>0) {
          this.ball(s,[0.25,0.37,0.14],[x,3.16,z+0.73]);
          this.box(s,[0.15,0.24,0.23],[x,3.12,z+0.83]);
          this.box(s,[0.34,0.1,0.13],[x,2.89,z+0.8]);
        }
      }
      for (let i=0;i<5;i++) for (const z of [-1.8,1.8]) this.box(s,[0.5,0.38,0.48],[-1.8+i*0.9,3.17,z],true);
      for (const x of [-2.35,2.35]) for (let i=0;i<3;i++) this.box(s,[0.48,0.38,0.5],[x,3.17,-0.95+i*0.95],true);
      s.bridge=s.joint(new T.Vector3(0,0.11,2.09));
      this.box(s,[1.36,0.14,1.95],[0,0,0.93],false,s.bridge);
      for(let i=0;i<5;i++) this.box(s,[1.38,0.045,0.035],[0,0.085,i*0.35+0.2],false,s.bridge);
      for (const x of [-0.62, 0.62]) this.detailBox(s,[0.08,0.2,1.72],[x,0.1,0.94],s.bridge);
      s.bridge.rotation.x=-Math.PI/2;
      for(const x of [-2.4,2.4]) for(const z of [-1.85,1.85]) {
        this.cylinder(s,0.45,0.55,0.2,[x,4.06,z]);
        const pivot=s.joint(new T.Vector3(x,4.62,z));
        for (const side of [-1,1]) this.box(s,[0.12,0.5,0.42],[x+side*0.3,4.36,z]);
        pivot.quaternion.setFromUnitVectors(UP,new T.Vector3(0,0.5,Math.sqrt(0.75)));
        const slide=new T.Group();pivot.add(slide);
        this.cylinder(s,0.22,0.3,1.35,[0,0.5,0],false,slide);
        this.cylinder(s,0.29,0.29,0.14,[0,1.18,0],false,slide);
        const bore=this.cylinder(s,0.18,0.18,0.015,[0,1.26,0],false,slide);bore.material=this.dark;
        const muzzle=new T.Object3D();muzzle.position.y=1.3;slide.add(muzzle);
        this.weapon(s,pivot,muzzle,slide);
      }
    }
    bunker(s) {
      // Each layer is a capped solid frustum, never an open cylindrical shell.
      for(let i=0;i<7;i++) this.cylinder(s,1.65+(i+1)*0.09,1.65+i*0.09,0.5,[0,0.24+i*0.48,0],true);
      s.launchers=[];
      for(let i=0;i<12;i++) {
        const a=i/12*Math.PI*2;
        const direction=new T.Vector3(0,0.5,Math.sqrt(0.75));
        const joint=this.arrow(s,new T.Vector3(Math.cos(a)*1.92,3.12,Math.sin(a)*1.92),direction,1.15+(i%3)*0.28);
        const tip=new T.Object3D(); tip.position.y=1.73+(i%3)*0.28; joint.add(tip); s.launchers.push(tip);
        const slide=new T.Group();joint.add(slide);
        this.weapon(s,joint,tip,slide);
      }
      for(let i=0;i<11;i++) {
        const a=i/11*Math.PI*2+0.2;
        this.arrow(s,new T.Vector3(Math.cos(a)*1.89,1.6+(i%3)*0.42,Math.sin(a)*1.89),new T.Vector3(Math.cos(a),0.2,Math.sin(a)),0.32);
      }
      const door=this.box(s,[0.42,0.65,0.07],[0,0.32,1.72]); door.material=this.dark;
      this.detailBox(s,[0.7,0.08,0.1],[0,0.72,1.69],null,this.dark);
      for (let i=0;i<4;i++) this.detailBox(s,[0.22,0.06,0.1],[-0.75+i*0.5,2.92,1.52],null,this.dark);
    }
    robot(s) {
      for (const side of [-1,1]) {
        const leg=s.joint(new T.Vector3(side*0.62,1.94,0)); leg.rotation.z=side*0.14;
        this.cylinder(s,0.29,0.33,1.03,[0,-0.47,0],false,leg);
        this.ball(s,[0.38,0.35,0.35],[0,-0.95,0],leg);
        this.box(s,[0.7,0.95,0.72],[0,-1.34,0],false,leg);
        this.box(s,[0.9,0.36,1.3],[0,-1.72,0.26],false,leg);
        this.box(s,[0.4,0.57,0.08],[0,-1.32,0.39],false,leg);
      }
      this.ball(s,[0.81,0.44,0.49],[0,2.08,0]);
      this.cylinder(s,0.55,0.55,0.55,[0,2.43,0]);
      this.ball(s,[1.11,0.87,0.61],[0,3.08,0]);
      this.box(s,[1.52,0.92,0.38],[0,3.1,0.4]);
      const emblem=this.cylinder(s,0.3,0.3,0.09,[0,3.12,0.65]); emblem.rotation.x=Math.PI/2;
      s.parts[s.parts.length-1].rotation.copy(emblem.quaternion);
      this.box(s,[0.07,0.33,0.07],[-0.07,3.1,0.74]);
      this.box(s,[0.2,0.07,0.07],[0.005,3.24,0.74]);
      this.box(s,[0.2,0.07,0.07],[0.005,3.1,0.74]);
      this.box(s,[0.07,0.17,0.07],[0.1,3.18,0.74]);
      s.arms=[];
      for(const side of [-1,1]) {
        const arm=s.joint(new T.Vector3(side*1.08,3.43,0)); s.arms.push(arm);
        this.ball(s,[0.46,0.46,0.44],[side*0.08,0,0],arm);
        this.cylinder(s,0.23,0.24,0.69,[side*0.16,-0.5,0],false,arm);
        this.ball(s,[0.28,0.28,0.29],[side*0.16,-0.84,0],arm);
        this.cylinder(s,0.32,0.37,0.62,[side*0.16,-1.17,0],false,arm);
         this.box(s,[0.68,0.62,0.65],[side*0.16,-1.66,0.08],false,arm);
         this.detailBox(s,[0.78,0.12,0.5],[side*0.16,-1.48,0.43],arm,this.dark);
        for(let i=0;i<3;i++) this.box(s,[0.16,0.38,0.14],[side*0.16-0.2+i*0.2,-1.69,0.41],false,arm);
      }
      s.head=s.joint(new T.Vector3(0,3.87,0));
      this.ball(s,[0.51,0.63,0.47],[0,0.35,0],s.head);
      const visor=this.box(s,[0.68,0.22,0.12],[0,0.38,0.44],false,s.head); visor.material=this.dark;
      this.box(s,[0.12,0.73,0.12],[0,0.3,0.53],false,s.head);
       this.box(s,[0.71,0.13,0.15],[0,0.06,0.44],false,s.head);
       this.box(s,[0.09,0.43,0.48],[0,0.91,0],false,s.head);
       this.detailBox(s,[0.78,0.05,0.12],[0,0.78,0.4],s.head,this.dark);
    }
    tank(s) {
      s.wheels=[]; s.treads=[];
      this.box(s,[2.5,0.86,3.75],[0,0.83,0]);
      this.box(s,[2.66,0.37,3.6],[0,1.3,0]);
      for (const x of [-0.92, 0.92]) this.detailBox(s,[0.18,0.12,2.75],[x,1.52,0]);
      for(const side of [-1,1]) {
        const shape=new T.Shape();
        shape.moveTo(-1.3,0.13); shape.lineTo(1.3,0.13);
        shape.absarc(1.3,0.83,0.7,-Math.PI/2,Math.PI/2,false);
        shape.lineTo(-1.3,1.53); shape.absarc(-1.3,0.83,0.7,Math.PI/2,Math.PI*1.5,false); shape.closePath();
        const track=this.extrude(s,shape,0.6,[side*1.35,0,0]); track.rotation.y=Math.PI/2;
        if(side<0) track.position.x-=0.6;
        const p=s.parts[s.parts.length-1]; p.home.copy(track.position); p.rotation.copy(track.quaternion);
        for(let i=0;i<5;i++) {
          const w=this.cylinder(s,0.54,0.54,0.1,[side*1.98,0.81,-1.35+i*0.675]);
          w.rotation.z=Math.PI/2; s.parts[s.parts.length-1].rotation.copy(w.quaternion); s.wheels.push(w);
           const hub=this.cylinder(s,0.16,0.16,0.12,[side*2.04,0.81,-1.35+i*0.675]);
           hub.rotation.z=Math.PI/2; s.parts[s.parts.length-1].rotation.copy(hub.quaternion);
           const cap=this.detailCylinder(s,0.09,0.14,[side*2.11,0.81,-1.35+i*0.675],null,this.dark);
           cap.rotation.z=Math.PI/2; s.parts[s.parts.length-1].rotation.copy(cap.quaternion);
        }
        for(let i=0;i<20;i++) {
          const a=i/20*Math.PI*2;
          const tread=this.box(s,[0.65,0.1,0.2],[side*1.65,0.83+Math.cos(a)*0.7,Math.sin(a)*2.05]);
          tread.rotation.x=-a; s.parts[s.parts.length-1].rotation.copy(tread.quaternion); s.treads.push(tread);
        }
      }
      s.turret=s.joint(new T.Vector3(0,1.49,-0.3));
      this.cylinder(s,1.01,1.14,0.65,[0,0.28,0],false,s.turret);
      this.ball(s,[1.03,0.81,1.01],[0,0.55,0],s.turret);
      this.detailCylinder(s,1.16,0.08,[0,0.08,0],s.turret,this.dark);
      const slit=this.box(s,[0.8,0.12,0.13],[0,0.94,0.79],false,s.turret); slit.material=this.dark;
      const barrel=s.joint(new T.Vector3()); s.group.remove(barrel); s.turret.add(barrel);
      barrel.position.set(0,0.55,0.73); barrel.rotation.x=Math.PI/2-0.12;
      this.cylinder(s,0.2,0.23,1.67,[0,0.76,0],false,barrel);
      this.cylinder(s,0.34,0.29,0.82,[0,1.81,0],false,barrel);
      this.detailCylinder(s,0.3,0.1,[0,1.42,0],barrel,this.dark);
      // Shallow, capped muzzle recess: dark sand, not an uncapped tube.
      const bore=this.cylinder(s,0.23,0.23,0.015,[0,2.229,0],false,barrel); bore.material=this.dark;
      s.muzzle=new T.Object3D(); s.muzzle.position.y=2.3; barrel.add(s.muzzle);
      s.barrel=barrel;
    }
    kesatria(s) {
      this.box(s,[1.25,1.35,0.65],[0,1.65,0]);
      this.ball(s,[0.72,0.72,0.62],[0,2.78,0]);
      this.cylinder(s,0.35,0.4,1.3,[-0.43,0.65,0]);
      this.cylinder(s,0.35,0.4,1.3,[0.43,0.65,0]);
      s.arms=[];
      for (const side of [-1, 1]) {
        const arm=s.joint(new T.Vector3(side*0.85,2.1,0)); s.arms.push(arm);
        this.cylinder(s,0.18,0.24,1.05,[0,-0.5,0],false,arm);
        this.ball(s,[0.28,0.28,0.28],[0,-1.04,0],arm);
      }
      const sword=s.joint(new T.Vector3(0.85,1.1,0));
      this.box(s,[0.12,1.65,0.12],[0,0.8,0],false,sword);
      this.box(s,[0.55,0.12,0.12],[0,0.12,0],false,sword);
      s.head=s.joint(new T.Vector3(0,3.22,0)); this.ball(s,[0.54,0.48,0.48],[0,0,0],s.head);
    }
    gargoyle(s) {
      this.ball(s,[0.85,0.64,0.72],[0,1.8,0]);
      this.ball(s,[0.5,0.45,0.5],[0,2.55,0.18]);
      s.wings=[];
      for (const side of [-1,1]) {
        const wing=s.joint(new T.Vector3(side*0.68,2.05,0)); s.wings.push(wing);
        this.box(s,[1.65,0.16,0.82],[side*0.82,0,0],false,wing);
        this.box(s,[0.8,0.12,0.62],[side*1.8,-0.15,0],false,wing);
        this.cylinder(s,0.14,0.2,0.95,[side*0.45,0.78,0.1]);
      }
      for (const side of [-1,1]) this.cylinder(s,0.16,0.23,1.15,[side*0.36,0.72,0]);
    }
    fire(owner, muzzle, delay) {
      if (this.projectiles.length >= 32 || this.projectiles.some(p => p.owner===owner && p.age<0.25 && owner.type==='tank')) return false;
      this.scene.updateWorldMatrix(true, true);
      const mesh=new T.Mesh(owner.type==='benteng'?this.cannonballGeometry:this.projectileGeometry,this.material);
      const localMatrix = this.scene.matrixWorld.clone().invert().multiply(muzzle.matrixWorld);
      const direction=UP.clone().transformDirection(localMatrix);
      const position=new T.Vector3().setFromMatrixPosition(localMatrix);
      mesh.position.copy(position); mesh.quaternion.setFromUnitVectors(UP,direction);
      mesh.visible=delay===0; this.scene.add(mesh);
      this.projectiles.push({mesh,owner,age:-delay,velocity:direction.multiplyScalar(owner.type==='benteng'?15:owner.type==='tank'?12:8),previous:position.clone()});
      return true;
    }
    clearProjectiles(owner) {
      for(let i=this.projectiles.length-1;i>=0;i--) if(this.projectiles[i].owner===owner) {
        this.scene.remove(this.projectiles[i].mesh); this.projectiles.splice(i,1);
      }
    }
    update(dt) {
      dt=clamp(Number.isFinite(dt)?dt:0,0,0.05);
      this.grains.update(dt);
      this.structures.forEach(s=>s.update(dt));
      for(let i=this.projectiles.length-1;i>=0;i--) {
        const p=this.projectiles[i]; p.age+=dt;
        if(p.age<0) continue;
        p.mesh.visible=true; p.previous.copy(p.mesh.position);
        p.velocity.y-=dt*5.5; p.mesh.position.addScaledVector(p.velocity,dt);
        const start=this.scene.localToWorld(p.previous.clone());
        const end=this.scene.localToWorld(p.mesh.position.clone());
        const direction=end.sub(start); const distance=direction.length();
        p.mesh.quaternion.setFromUnitVectors(UP,p.velocity.clone().normalize());
        this.raycaster.set(start,direction.normalize()); this.raycaster.far=distance;
        let hit=false;
        for(const target of this.structures) {
          if(target===p.owner || target.state!=='built') continue;
          const hits=this.raycaster.intersectObjects(target.getColliders(),false);
          if(hits.length) { p.mesh.position.copy(this.scene.worldToLocal(hits[0].point.clone())); target.damage(12, hits[0].point); hit=true; break; }
        }
        if(hit || p.mesh.position.y<=0.08 || p.age>5) {
          p.mesh.position.y=Math.max(0.08,p.mesh.position.y);
          this.effects.burst(p.mesh.position,18,false,p.owner);
          this.scene.remove(p.mesh); this.projectiles.splice(i,1);
        }
      }
      this.effects.update(dt);
    }
    dispose() {
      [...this.structures].forEach(s=>s.dispose()); this.effects.dispose();
      this.grains.dispose();
      this.material.dispose(); this.blocks.dispose(); this.dark.dispose(); this.projectileGeometry.dispose();
      this.cannonballGeometry.dispose();
    }
  }
export { SandStructureSystem };
