import { Vector3, type DirectionalLight, type PerspectiveCamera } from 'three';
import { clamp } from '../core/math';

const MAP_SIZE = 4096;
/** Extra depth on both sides of the fitted sphere so hills and towers still cast into it. */
const DEPTH_MARGIN = 500;

const corners = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
  [0, -0.6],
] as const;

/**
 * Fits the sun's single shadow map to the part of the ground the camera can see.
 *
 * The visible ground patch is bounded by a sphere, so the map covers the same area
 * whichever way the camera faces, and the sphere centre is snapped to whole shadow texels
 * so shadows do not crawl while panning. The radius is quantised for the same reason.
 */
export class ShadowFitter {
  private readonly centre = new Vector3();
  private readonly axisX = new Vector3();
  private readonly axisY = new Vector3();
  private readonly ray = new Vector3();
  private readonly point = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private radius = 0;
  /** World size of one shadow texel, for debugging and bias tuning. */
  texel = 0;

  constructor(private readonly light: DirectionalLight) {
    light.shadow.mapSize.set(MAP_SIZE, MAP_SIZE);
    light.shadow.radius = 2.2;
    light.shadow.bias = -0.00012;
  }

  update(camera: PerspectiveCamera, sunDir: Vector3, groundY: number, viewDistance: number): void {
    // Where the view frustum meets the ground, limited so a low camera does not ask the
    // map to cover the whole horizon.
    const maxRange = clamp(viewDistance * 3.2, 260, 3200);
    let n = 0;
    let cx = 0;
    let cz = 0;
    const pts = this.scratch;
    for (const [sx, sy] of corners) {
      this.ray.set(sx, sy, 0.5).unproject(camera).sub(camera.position).normalize();
      let t = maxRange;
      if (this.ray.y < -1e-4) t = Math.min(maxRange, (groundY - camera.position.y) / this.ray.y);
      this.point.copy(camera.position).addScaledVector(this.ray, t);
      pts[n * 2] = this.point.x;
      pts[n * 2 + 1] = this.point.z;
      cx += this.point.x;
      cz += this.point.z;
      n++;
    }
    cx /= n;
    cz /= n;
    let r = 0;
    for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(pts[i * 2]! - cx, pts[i * 2 + 1]! - cz));
    // Quantise the radius to ~12% steps so small camera moves do not resize the map.
    r = clamp(r * 1.05, 90, 2400);
    const q = Math.pow(1.12, Math.ceil(Math.log(r) / Math.log(1.12)));
    const radiusChanged = q !== this.radius;
    this.radius = q;
    this.texel = (2 * q) / MAP_SIZE;

    // Light-space axes, matching the basis three.js builds in lookAt().
    this.axisX.crossVectors(this.up, sunDir).normalize();
    this.axisY.crossVectors(sunDir, this.axisX).normalize();
    this.centre.set(cx, groundY, cz);
    const lx = Math.round(this.centre.dot(this.axisX) / this.texel) * this.texel;
    const ly = Math.round(this.centre.dot(this.axisY) / this.texel) * this.texel;
    const lz = this.centre.dot(sunDir);
    this.centre.set(0, 0, 0).addScaledVector(this.axisX, lx).addScaledVector(this.axisY, ly).addScaledVector(sunDir, lz);

    const light = this.light;
    light.target.position.copy(this.centre);
    light.position.copy(this.centre).addScaledVector(sunDir, q + DEPTH_MARGIN);
    light.target.updateMatrixWorld();

    if (radiusChanged) {
      const cam = light.shadow.camera;
      cam.left = -q;
      cam.right = q;
      cam.top = q;
      cam.bottom = -q;
      cam.near = 1;
      cam.far = 2 * (q + DEPTH_MARGIN);
      cam.updateProjectionMatrix();
      // Offset along the normal by about a texel and a half hides acne on slopes.
      light.shadow.normalBias = this.texel * 1.6;
    }
  }

  private readonly scratch = new Float32Array(corners.length * 2);
}
