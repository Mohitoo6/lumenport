import { Vector3, type PerspectiveCamera } from 'three';
import { CELL, WATER_LEVEL } from '../core/constants';
import type { Building } from '../sim/zoning/zones';
import { heightAt } from '../sim/map/terrain';

const dir = new Vector3();
const origin = new Vector3();

/**
 * Finds where the ray through a screen point (normalised device coordinates) hits the
 * terrain or the water surface. Marches the height field directly, which is far cheaper
 * than raycasting the chunk meshes. Returns false if the ray leaves toward the sky.
 */
export function pickGround(camera: PerspectiveCamera, ndcX: number, ndcY: number, heights: Float32Array, out: Vector3): boolean {
  origin.copy(camera.position);
  dir.set(ndcX, ndcY, 0.5).unproject(camera).sub(origin).normalize();
  const surface = (x: number, z: number): number => Math.max(WATER_LEVEL, heightAt(heights, x, z));

  let t0 = 0;
  let t = 0;
  const maxT = 9000;
  let hit = false;
  while (t < maxT) {
    const step = Math.max(2, t * 0.02);
    t0 = t;
    t += step;
    const y = origin.y + dir.y * t;
    if (y < surface(origin.x + dir.x * t, origin.z + dir.z * t)) {
      hit = true;
      break;
    }
    if (dir.y > 0 && y > 600) break;
  }
  if (!hit) return false;
  let lo = t0;
  let hi = t;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const y = origin.y + dir.y * mid;
    if (y < surface(origin.x + dir.x * mid, origin.z + dir.z * mid)) hi = mid;
    else lo = mid;
  }
  out.copy(origin).addScaledVector(dir, hi);
  return true;
}

/** Intersects the screen ray with a horizontal plane. Used for grab-panning. */
export function pickPlane(camera: PerspectiveCamera, ndcX: number, ndcY: number, planeY: number, out: Vector3): boolean {
  origin.copy(camera.position);
  dir.set(ndcX, ndcY, 0.5).unproject(camera).sub(origin).normalize();
  if (dir.y > -1e-3) return false;
  const t = (planeY - origin.y) / dir.y;
  if (t > 12000) return false;
  out.copy(origin).addScaledVector(dir, t);
  return true;
}

export interface BuildingHit {
  id: number;
  /** Distance along the ray. */
  t: number;
  x: number;
  z: number;
}

/**
 * Finds the nearest building whose box (lot footprint by current height) the screen ray
 * enters. Lets the cursor select a tower by pointing at its side, not only at its base.
 */
export function pickBuilding(
  camera: PerspectiveCamera,
  ndcX: number,
  ndcY: number,
  buildings: ReadonlyArray<Building | null>,
  heightOf: (id: number) => number,
  maxT: number,
): BuildingHit | null {
  origin.copy(camera.position);
  dir.set(ndcX, ndcY, 0.5).unproject(camera).sub(origin).normalize();
  let best: BuildingHit | null = null;
  for (const b of buildings) {
    if (!b) continue;
    const h = heightOf(b.id);
    if (h < 1) continue;
    // Slab test against the lot box, inset a little so gardens do not count.
    const x0 = b.x * CELL + 1.5;
    const x1 = (b.x + b.w) * CELL - 1.5;
    const z0 = b.y * CELL + 1.5;
    const z1 = (b.y + b.h) * CELL - 1.5;
    let tMin = 0;
    let tMax = best ? best.t : maxT;
    const axes: Array<[number, number, number, number]> = [
      [origin.x, dir.x, x0, x1],
      [origin.y, dir.y, b.baseY, b.baseY + h],
      [origin.z, dir.z, z0, z1],
    ];
    let hit = true;
    for (const [o, d, lo, hi] of axes) {
      if (Math.abs(d) < 1e-8) {
        if (o < lo || o > hi) hit = false;
      } else {
        let t0 = (lo - o) / d;
        let t1 = (hi - o) / d;
        if (t0 > t1) [t0, t1] = [t1, t0];
        if (t0 > tMin) tMin = t0;
        if (t1 < tMax) tMax = t1;
        if (tMin > tMax) hit = false;
      }
      if (!hit) break;
    }
    if (hit) best = { id: b.id, t: tMin, x: origin.x + dir.x * tMin, z: origin.z + dir.z * tMin };
  }
  return best;
}
