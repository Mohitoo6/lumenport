import { DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, MeshStandardMaterial } from 'three';
import { angleDelta } from '../../core/math';
import { CAR_KINDS, MAX_CARS, type Traffic } from '../../sim/traffic/traffic';
import { CAR_PAINT, buildCars } from './carGeometry';

/**
 * Draws every car with one instanced mesh per body style. Positions are interpolated
 * between the last two simulation ticks so motion is smooth at any frame rate and game
 * speed. Instance matrices are written straight into the buffers: no per-frame garbage.
 */
export class VehicleRenderer {
  readonly group = new Group();
  private readonly meshes: InstancedMesh[] = [];
  private readonly fill = new Int32Array(CAR_KINDS);

  constructor() {
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

  /** `alpha` is how far the frame is between the previous tick (0) and the current one (1). */
  update(t: Traffic, alpha: number): void {
    const fill = this.fill;
    fill.fill(0);
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
      const paint = CAR_PAINT[t.color[i]!]!;
      const col = mesh.instanceColor!.array;
      col[k * 3] = paint[0];
      col[k * 3 + 1] = paint[1];
      col[k * 3 + 2] = paint[2];
    }
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
