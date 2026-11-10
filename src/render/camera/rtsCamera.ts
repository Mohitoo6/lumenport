import { PerspectiveCamera, Vector3 } from 'three';
import { WORLD } from '../../core/constants';
import { angleDelta, clamp, damp, smoothstep } from '../../core/math';

export interface CameraPose {
  x: number;
  z: number;
  /** Radians. 0 looks toward -z (north); positive turns clockwise seen from above. */
  yaw: number;
  /** Radians above the horizon: 90 degrees is straight down. */
  pitch: number;
  /** Distance from the focus point in metres. */
  dist: number;
}

const MIN_DIST = 28;
const MAX_DIST = 2600;
const MIN_PITCH = (14 * Math.PI) / 180;
const MAX_PITCH = (86 * Math.PI) / 180;
const MARGIN = 150;

/**
 * City-builder camera. It orbits a focus point that slides along the ground; every input
 * moves a goal pose and the real pose eases toward it, so motion is smooth at any frame
 * rate. Input handling lives in game/input.ts and calls the methods here.
 */
export class RtsCamera {
  readonly camera: PerspectiveCamera;
  readonly pose: CameraPose = { x: WORLD / 2, z: WORLD / 2, yaw: 0.6, pitch: 0.8, dist: 700 };
  readonly goal: CameraPose = { ...this.pose };
  /** Ground height under the focus point, eased. */
  focusY = 0;
  /** Ground height lookup supplied by the game. */
  heightAt: (x: number, z: number) => number = () => 0;

  private readonly forward = new Vector3();
  private readonly look = new Vector3();

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(38, aspect, 2, 14000);
  }

  setPose(p: Partial<CameraPose>, instant = false): void {
    Object.assign(this.goal, p);
    this.clampGoal();
    if (instant) {
      Object.assign(this.pose, this.goal);
      this.focusY = Math.max(0, this.heightAt(this.pose.x, this.pose.z));
      this.apply();
    }
  }

  /** Moves the focus in screen-relative ground directions. Units are fractions of view distance. */
  pan(right: number, forward: number): void {
    const s = this.goal.dist;
    const sin = Math.sin(this.goal.yaw);
    const cos = Math.cos(this.goal.yaw);
    this.goal.x += (cos * right + sin * forward) * s;
    this.goal.z += (sin * right - cos * forward) * s;
    this.clampGoal();
  }

  /** Moves the focus by a world-space ground offset (used by grab-panning). */
  panWorld(dx: number, dz: number): void {
    this.goal.x += dx;
    this.goal.z += dz;
    this.clampGoal();
  }

  rotate(dYaw: number, dPitch: number): void {
    this.goal.yaw += dYaw;
    this.goal.pitch += dPitch;
    this.clampGoal();
  }

  /**
   * Zooms by a factor, keeping `anchor` (a ground point, usually under the cursor) fixed
   * on screen.
   */
  zoom(factor: number, anchorX?: number, anchorZ?: number): void {
    const before = this.goal.dist;
    const after = clamp(before * factor, MIN_DIST, MAX_DIST);
    if (anchorX !== undefined && anchorZ !== undefined) {
      const k = 1 - after / before;
      this.goal.x += (anchorX - this.goal.x) * k;
      this.goal.z += (anchorZ - this.goal.z) * k;
    }
    this.goal.dist = after;
    this.clampGoal();
  }

  private clampGoal(): void {
    const g = this.goal;
    g.x = clamp(g.x, -MARGIN, WORLD + MARGIN);
    g.z = clamp(g.z, -MARGIN, WORLD + MARGIN);
    g.dist = clamp(g.dist, MIN_DIST, MAX_DIST);
    g.pitch = clamp(g.pitch, MIN_PITCH, MAX_PITCH);
  }

  update(dt: number): void {
    const p = this.pose;
    const g = this.goal;
    p.x = damp(p.x, g.x, 9, dt);
    p.z = damp(p.z, g.z, 9, dt);
    p.dist = damp(p.dist, g.dist, 8, dt);
    p.pitch = damp(p.pitch, g.pitch, 8, dt);
    p.yaw += angleDelta(p.yaw, g.yaw) * (1 - Math.exp(-8 * dt));
    this.focusY = damp(this.focusY, Math.max(0, this.heightAt(p.x, p.z)), 5, dt);
    this.apply();
  }

  /** Effective pitch: close to the ground the view tips toward the horizon for a street-level feel. */
  private effectivePitch(): number {
    const p = this.pose;
    return p.pitch * (0.72 + 0.28 * smoothstep(40, 420, p.dist));
  }

  private apply(): void {
    const p = this.pose;
    const cam = this.camera;
    const pitch = this.effectivePitch();
    const horiz = Math.cos(pitch) * p.dist;
    // Forward on the ground for yaw 0 is -z.
    this.forward.set(Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    cam.position.set(p.x - this.forward.x * horiz, this.focusY + Math.sin(pitch) * p.dist, p.z - this.forward.z * horiz);
    // Keep the camera above the terrain it is flying over.
    const floor = this.heightAt(cam.position.x, cam.position.z) + 4;
    if (cam.position.y < floor) cam.position.y = floor;
    this.look.set(p.x, this.focusY, p.z);
    cam.lookAt(this.look);
    cam.near = clamp(p.dist * 0.04, 1.5, 30);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
