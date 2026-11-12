import { Matrix4, Vector3, type Group, type Object3D } from 'three';
import type { Rig } from './humanoid';

/**
 * Brings a seated humanoid to life: breathing, blinking, looking at whoever is talking,
 * hand-to-chin while thinking, and gestures, nods and a moving mouth while speaking.
 * Hands are placed with a two-bone IK, so poses are written as "where the hand goes".
 */

export type ActorMode = 'listen' | 'think' | 'speak' | 'silent';

const UPPER = 0.28;
/** Elbow to the middle of the hand. */
const LOWER = 0.295;

const _m1 = new Matrix4();
const _m2 = new Matrix4();

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _d = new Vector3();
const _e = new Vector3();
const _w = new Vector3();

/**
 * Rotates `shoulder` and bends `elbow` so the hand reaches `target` (in the shoulder's
 * parent space). `pole` is the direction the elbow should point, in the same space.
 */
export function reach(shoulder: Group, elbow: Group, target: Vector3, pole: Vector3): void {
  const d = _d.copy(target).sub(shoulder.position);
  const len = Math.min(UPPER + LOWER - 1e-3, Math.max(Math.abs(UPPER - LOWER) + 1e-3, d.length()));
  // Interior angle at the elbow, by the law of cosines.
  const cosI = (UPPER * UPPER + LOWER * LOWER - len * len) / (2 * UPPER * LOWER);
  const bend = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosI)));
  // In the arm's own frame the upper arm hangs along -y and the forearm bends toward +z.
  const elbowLocal = _e.set(0, -UPPER, 0);
  const wristLocal = _w.set(0, -UPPER - LOWER * Math.cos(bend), LOWER * Math.sin(bend));
  const a1 = _a.copy(wristLocal).normalize();
  const e1 = _b.copy(elbowLocal).addScaledVector(a1, -elbowLocal.dot(a1)).normalize();
  const c1 = _c.crossVectors(a1, e1);
  _m1.makeBasis(a1, e1, c1);
  const a2 = d.normalize();
  const e2 = _b.copy(pole).addScaledVector(a2, -pole.dot(a2));
  if (e2.lengthSq() < 1e-8) e2.set(0, -1, 0);
  e2.normalize();
  const c2 = _c.crossVectors(a2, e2);
  _m2.makeBasis(a2, e2, c2);
  _m1.transpose();
  _m2.multiply(_m1);
  shoulder.quaternion.setFromRotationMatrix(_m2);
  elbow.rotation.set(-bend, 0, 0);
}

function damp(cur: number, goal: number, rate: number, dt: number): number {
  return cur + (goal - cur) * (1 - Math.exp(-rate * dt));
}

function dampV(cur: Vector3, goal: Vector3, rate: number, dt: number): void {
  cur.lerp(goal, 1 - Math.exp(-rate * dt));
}

/** Seat-space hand positions (x to the figure's left, y up, z forward). */
const REST_L = new Vector3(0.17, 0.81, 0.4);
const REST_R = new Vector3(-0.17, 0.81, 0.4);

interface Gesture {
  l: Vector3 | null;
  r: Vector3 | null;
  lean: number;
}

/** Hand poses used while talking. `null` keeps that hand resting on the table. */
const GESTURES: Gesture[] = [
  { l: null, r: new Vector3(-0.24, 1.0, 0.44), lean: 0.08 },
  { l: new Vector3(0.22, 0.98, 0.44), r: new Vector3(-0.22, 0.98, 0.44), lean: 0.12 },
  { l: null, r: new Vector3(-0.1, 1.04, 0.6), lean: 0.16 },
  { l: new Vector3(0.12, 0.97, 0.42), r: new Vector3(-0.16, 1.03, 0.4), lean: 0.06 },
  { l: new Vector3(0.24, 1.0, 0.44), r: null, lean: 0.08 },
  { l: null, r: new Vector3(-0.15, 0.83, 0.52), lean: 0.14 },
  { l: new Vector3(0.18, 0.95, 0.5), r: new Vector3(-0.18, 0.95, 0.5), lean: 0.18 },
];

export class Actor {
  mode: ActorMode = 'listen';
  /** Where to look, in world space (the speaker's head, or the mayor). */
  readonly lookTarget = new Vector3();
  /** Head height in seat space, for others to look at. */
  static readonly HEAD_Y = 1.36;

  private t: number;
  private blinkIn: number;
  private blink = 0;
  private gesture = 0;
  private gestureIn = 0;
  private nodIn: number;
  private nod = 0;
  private readonly handL = REST_L.clone();
  private readonly handR = REST_R.clone();
  private readonly goalL = new Vector3();
  private readonly goalR = new Vector3();
  private lean = 0;
  private yaw = 0;
  private pitch = 0;
  private mouth = 0;
  private readonly poleL = new Vector3();
  private readonly poleR = new Vector3();
  private readonly tmp = new Vector3();
  private readonly inv = new Matrix4();
  private seed: number;

  constructor(
    readonly rig: Rig,
    seed: number,
  ) {
    this.seed = seed;
    this.t = seed * 3.7;
    this.blinkIn = 1 + (seed % 5) * 0.6;
    this.nodIn = 2 + (seed % 3);
  }

  get root(): Object3D {
    return this.rig.root;
  }

  /** World position of the head, for others to look at. */
  headWorld(out: Vector3): Vector3 {
    return this.rig.head.getWorldPosition(out).setY(this.rig.root.position.y + Actor.HEAD_Y);
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  update(dt: number): void {
    const r = this.rig;
    this.t += dt;
    const t = this.t;
    const speaking = this.mode === 'speak';
    const thinking = this.mode === 'think';

    // Hands: rest, a gesture while talking, or hand to chin while thinking.
    this.goalL.copy(REST_L);
    this.goalR.copy(REST_R);
    let leanGoal = 0.02;
    if (speaking) {
      this.gestureIn -= dt;
      if (this.gestureIn <= 0) {
        this.gesture = Math.floor(this.rand() * GESTURES.length);
        this.gestureIn = 0.9 + this.rand() * 1.1;
      }
      const g = GESTURES[this.gesture]!;
      // A beat on the active hands, roughly with the rhythm of speech.
      const beat = Math.sin(t * 7.3) * 0.022 + Math.sin(t * 3.1) * 0.012;
      if (g.l) this.goalL.copy(g.l).y += beat;
      if (g.r) this.goalR.copy(g.r).y += beat * 1.2;
      leanGoal = g.lean;
    } else if (thinking) {
      this.goalR.set(-0.02, 1.25, 0.2);
      this.goalL.set(0.12, 0.81, 0.36);
      leanGoal = 0.14;
    } else if (this.mode === 'silent') {
      this.goalL.set(0.05, 0.8, 0.36);
      this.goalR.set(-0.05, 0.8, 0.38);
      leanGoal = -0.06;
    } else {
      // Listening: hands rest, sometimes loosely together.
      const together = Math.sin(t * 0.21 + this.seed) > 0.3;
      if (together) {
        this.goalL.set(0.07, 0.81, 0.42);
        this.goalR.set(-0.07, 0.81, 0.43);
      }
    }
    dampV(this.handL, this.goalL, speaking ? 7 : 4, dt);
    dampV(this.handR, this.goalR, speaking ? 7 : 4, dt);
    this.lean = damp(this.lean, leanGoal, 3, dt);

    // Breathing and posture.
    const breath = Math.sin(t * 1.6) * 0.012;
    r.spine.rotation.x = this.lean + breath;
    r.spine.rotation.z = Math.sin(t * 0.37 + this.seed) * 0.012;

    // Head: turn toward the look target, nod now and then.
    r.root.updateMatrixWorld();
    this.inv.copy(r.root.matrixWorld).invert();
    const local = this.tmp.copy(this.lookTarget).applyMatrix4(this.inv);
    const dx = local.x;
    const dz = local.z;
    const dy = local.y - Actor.HEAD_Y;
    const flat = Math.hypot(dx, dz);
    let yawGoal = Math.max(-1.2, Math.min(1.2, Math.atan2(dx, dz)));
    let pitchGoal = Math.max(-0.35, Math.min(0.3, -Math.atan2(dy, Math.max(0.3, flat))));
    if (thinking) {
      yawGoal *= 0.3;
      pitchGoal = 0.22 + Math.sin(t * 0.8) * 0.04;
    }
    this.yaw = damp(this.yaw, yawGoal, 4, dt);
    this.pitch = damp(this.pitch, pitchGoal, 4, dt);
    this.nodIn -= dt;
    if (this.nodIn <= 0) {
      this.nod = 1;
      this.nodIn = speaking ? 1.2 + this.rand() * 1.5 : 3 + this.rand() * 6;
    }
    this.nod = Math.max(0, this.nod - dt * 2.2);
    const nodAngle = Math.sin((1 - this.nod) * Math.PI * 2) * this.nod * (speaking ? 0.09 : 0.07);
    const talkBob = speaking ? Math.sin(t * 5.1) * 0.025 : 0;
    // Spread the turn over the spine and neck.
    r.spine.rotation.y = this.yaw * 0.25;
    r.neck.rotation.y = this.yaw * 0.75 - r.spine.rotation.y * 0.0;
    r.neck.rotation.x = this.pitch * 0.5;
    r.head.rotation.x = this.pitch * 0.5 + nodAngle + talkBob;
    r.head.rotation.z = thinking ? 0.1 : Math.sin(t * 0.5 + this.seed) * 0.03;

    // Mouth.
    const mouthGoal = speaking ? 0.12 + Math.max(0, Math.sin(t * 13.7) * 0.5 + Math.sin(t * 7.1) * 0.35 + Math.sin(t * 2.3) * 0.15) * 0.75 : 0.12;
    this.mouth = damp(this.mouth, mouthGoal, 18, dt);
    r.mouth.scale.y = this.mouth;

    // Blinking.
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blink = 1;
      this.blinkIn = 2 + this.rand() * 4;
    }
    this.blink = Math.max(0, this.blink - dt * 8);
    const shut = Math.sin(this.blink * Math.PI);
    const open = thinking ? -0.2 : -0.55;
    for (const lid of r.lids) lid.rotation.x = open + (1.5 - open) * shut;

    // Arms last, once the spine has moved: seat-space hand targets into spine space.
    r.spine.updateMatrixWorld();
    const toSpine = this.inv.copy(r.spine.matrixWorld).invert().multiply(r.root.matrixWorld);
    const tl = this.tmp.copy(this.handL).applyMatrix4(toSpine);
    this.poleL.set(0.5, -1, -0.35);
    if (thinking) this.poleR.set(-0.2, -1, 0.5);
    else this.poleR.set(-0.5, -1, -0.35);
    reach(r.shoulderL, r.elbowL, tl, this.poleL);
    const tr = this.tmp.copy(this.handR).applyMatrix4(toSpine);
    reach(r.shoulderR, r.elbowR, tr, this.poleR);
    // Hands: relaxed on the table, tipped up a little when gesturing.
    r.wristL.rotation.set(speaking ? -0.35 : 0.1, 0, 0);
    r.wristR.rotation.set(speaking ? -0.35 : thinking ? -0.2 : 0.1, 0, 0);
  }
}
