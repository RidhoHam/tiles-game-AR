/* Thin placement-guide lines that overlay the live webcam feed. */
import * as THREE from 'three';
import { guideLineX } from './arena-mesh.js';

// The lines sit on top of a camera feed, so they are kept hair-thin, unlit and
// slightly transparent; anything heavier would obscure the card being placed.
const LINE_COLOR = 0xffffff;
const LINE_OPACITY = 0.7;
const LINE_THICKNESS = 0.035;
const LINE_LIFT = 0.02;
const GUIDE_LENGTH = 24;

export class GuideLines {
  constructor(root) {
    this.root = root;
    this.group = new THREE.Group();
    this.group.name = 'guide-lines';
    this.group.visible = false;
    this._disposed = false;
    this._geometries = [];
    this._materials = [];

    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: LINE_COLOR, transparent: true, opacity: LINE_OPACITY,
      depthWrite: false, side: THREE.DoubleSide
    });
    this._geometries.push(geometry);
    this._materials.push(material);

    this.lines = [0, 1, 2].map(index => {
      const line = new THREE.Mesh(geometry, material);
      line.name = ['guide-left', 'guide-center', 'guide-right'][index];
      line.scale.set(LINE_THICKNESS, 1, GUIDE_LENGTH);
      line.visible = false;
      this.group.add(line);
      return line;
    });

    this.root.add(this.group);
  }

  /** Positions the three lines for `arena` and makes them visible. */
  show(arena) {
    if (this._disposed) return;
    const [left, center, right] = guideLineX(arena);
    const z = Number.isFinite(arena?.centerZ) ? arena.centerZ : 0;
    const xs = [left, center, right];
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      line.position.set(xs[i], LINE_LIFT, z);
      line.scale.set(LINE_THICKNESS, 1, GUIDE_LENGTH);
      line.visible = true;
      line.updateMatrix();
    }
    this.group.visible = true;
  }

  /** Hides the guide; used outside the card-placement phase. */
  hide() {
    if (this._disposed) return;
    for (const line of this.lines) line.visible = false;
    this.group.visible = false;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const line of this.lines) line.visible = false;
    this.group.visible = false;
    if (this.group.parent) this.group.parent.remove(this.group);
    for (const line of this.lines) this.group.remove(line);
    for (const geometry of this._geometries) geometry.dispose();
    for (const material of this._materials) material.dispose();
    this._geometries.length = 0;
    this._materials.length = 0;
    this.lines.length = 0;
    this.root = null;
  }
}

