import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import { angleDelta } from '../../core/math';
import { BUS_KIND, CAR_KINDS, MAX_CARS, type Traffic } from '../../sim/traffic/traffic';
import { BUS_PAINT, CAR_PAINT, buildCars } from './carGeometry';

/**
 * Draws every car with one instanced mesh per body style. Positions are interpolated
 * between the last two simulation ticks so motion is smooth at any frame rate and game
 * speed. Instance matrices are written straight into the buffers: no per-frame garbage.
 */
export class VehicleRenderer {
  readonly group = new Group();
  private readonly meshes: InstancedMesh[] = [];
  private readonly fill = new Int32Array(CAR_KINDS);
  /** Headlights and tail lights: small bright quads on every car, shown at night. */
  private readonly lights: InstancedMesh;
  private readonly lightMat = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, fog: false });

  constructor() {
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const quad = (x: number, z: number, w: number, c: [number, number, number]): void => {
      const base = pos.length / 3;
      pos.push(x - w, 0.56, z, x + w, 0.56, z, x + w, 0.72, z, x - w, 0.72, z);
      for (let i = 0; i < 4; i++) col.push(...c);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (const sx of [-0.62, 0.62]) {
      quad(sx, 2.24, 0.17, [1, 0.95, 0.8]);
      quad(sx, -2.24, 0.19, [1, 0.06, 0.03]);
    }
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    lg.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    lg.setIndex(idx);
    this.lights = new InstancedMesh(lg, this.lightMat, MAX_CARS);
    this.lights.count = 0;
    this.lights.instanceMatrix.setUsage(DynamicDrawUsage);
    this.lights.frustumCulled = false;
    this.lights.matrixAutoUpdate = false;
    this.lights.visible = false;
    this.group.add(this.lights);

    const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.35 });
    for (const geo of buildCars()) {
      const mesh = new InstancedMesh(geo, material, MAX_CARS);
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX_CARS * 3), 3);
      mesh.instanceColor.setUsage(DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  /** Cars cast shadows only when the camera is close enough to see them. */
  setCastShadow(on: boolean): void {
    for (const m of this.meshes) m.castShadow = on;
  }

  /** `alpha` is how far the frame is between the previous tick (0) and the current one (1). */
  update(t: Traffic, alpha: number, night = 0): void {
    const fill = this.fill;
    fill.fill(0);
    const lit = night > 0.03;
    this.lights.visible = lit;
    // Well above the bloom threshold, so the lights glow.
    this.lightMat.color.setScalar(night * 7);
    const lm = this.lights.instanceMatrix.array;
    for (let i = 0; i < t.count; i++) {
      const kind = t.kind[i]!;
      const mesh = this.meshes[kind]!;
      const k = fill[kind]!++;
      const x = t.px[i]! + (t.x[i]! - t.px[i]!) * alpha;
      const y = t.py[i]! + (t.y[i]! - t.py[i]!) * alpha;
      const z = t.pz[i]! + (t.z[i]! - t.pz[i]!) * alpha;
      const h = t.pheading[i]! + angleDelta(t.pheading[i]!, t.heading[i]!) * alpha;
      const c = Math.cos(h);
      const s = Math.sin(h);
      const m = mesh.instanceMatrix.array;
      const o = k * 16;
      // Rotation about +y by h, then translation. Local +z is the car's nose.
      m[o] = c;
      m[o + 1] = 0;
      m[o + 2] = -s;
      m[o + 3] = 0;
      m[o + 4] = 0;
      m[o + 5] = 1;
      m[o + 6] = 0;
      m[o + 7] = 0;
      m[o + 8] = s;
      m[o + 9] = 0;
      m[o + 10] = c;
      m[o + 11] = 0;
      m[o + 12] = x;
      m[o + 13] = y + 0.02;
      m[o + 14] = z;
      m[o + 15] = 1;
      if (lit) for (let c2 = 0; c2 < 16; c2++) lm[i * 16 + c2] = m[o + c2]!;
      const paint = kind === BUS_KIND ? BUS_PAINT : CAR_PAINT[t.color[i]!]!;
      const col = mesh.instanceColor!.array;
      col[k * 3] = paint[0];
      col[k * 3 + 1] = paint[1];
      col[k * 3 + 2] = paint[2];
    }
    this.lights.count = lit ? t.count : 0;
    if (lit) this.lights.instanceMatrix.needsUpdate = true;
    for (let kind = 0; kind < this.meshes.length; kind++) {
      const mesh = this.meshes[kind]!;
      mesh.count = fill[kind]!;
      if (mesh.count > 0) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor!.needsUpdate = true;
      }
    }
  }
}
