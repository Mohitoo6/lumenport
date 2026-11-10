import { Vector3, type PerspectiveCamera } from 'three';
import { WATER_LEVEL } from '../core/constants';
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
