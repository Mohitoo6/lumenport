import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL, MAP } from '../../core/constants';
import { heightAt } from '../../sim/map/terrain';
import type { GameState } from '../../sim/state';
import { METRO, isStation, type MetroLine } from '../../sim/transit/metro';
import { METRO_DECK } from '../buildings/facilities';

/**
 * The elevated metro: a concrete box-girder viaduct on round piers along each line, two
 * tracks on top, and a three-car train on each track shuttling between the stations.
 */

const DECK_HALF = 3.4;
const GIRDER = 1.5;
const TRACK = 1.6;
const PIER_EVERY = 30;
const CAR_LEN = 16;
const CAR_GAP = 1;
const CARS = 3;
const TRAIN_SPEED = 16;
const DWELL = 6;
const MAX_TRAINS = 64;

interface Profile {
  /** Sample positions and deck heights. */
  x: number[];
  z: number[];
  y: number[];
  /** Arc length at each sample. */
  s: number[];
  length: number;
}

interface Train {
  line: number;
  /** Track offset sign (+1 / -1) and phase offset in seconds. */
  side: number;
  phase: number;
}

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpP = new Vector3();
const tmpS = new Vector3(1, 1, 1);
const up = new Vector3(0, 1, 0);
const fwd = new Vector3();
const side = new Vector3();
const basis = new Matrix4();

export class MetroRenderer {
  readonly group = new Group();
  private deck: Mesh | null = null;
  private rails: Mesh | null = null;
  private piers: Mesh | null = null;
  private readonly concrete = new MeshStandardMaterial({ color: new Color(0.46, 0.46, 0.45), roughness: 0.9, side: DoubleSide });
  private readonly steel = new MeshStandardMaterial({ color: new Color(0.36, 0.37, 0.4), roughness: 0.4, metalness: 0.8, side: DoubleSide });
  private readonly body = new MeshStandardMaterial({ color: new Color(0.86, 0.88, 0.9), roughness: 0.35, metalness: 0.4 });
  private readonly glass = new MeshStandardMaterial({ color: new Color(0.05, 0.07, 0.1), roughness: 0.15, metalness: 0.2, emissive: new Color(1, 0.86, 0.6), emissiveIntensity: 0 });
  private readonly stripe = new MeshStandardMaterial({ color: new Color(0.03, 0.5, 0.58), roughness: 0.5 });
  private readonly bodies: InstancedMesh;
  private readonly windows: InstancedMesh;
  private readonly stripes: InstancedMesh;
  private profiles = new Map<number, Profile>();
  private trains: Train[] = [];
  private time = 0;
  private readonly previewMat = new MeshBasicMaterial({ color: new Color(0.3, 0.9, 0.6), transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide });
  private preview: Mesh | null = null;

  constructor() {
    const car = new BoxGeometry(2.9, 2.6, CAR_LEN);
    car.translate(0, 1.85, 0);
    this.bodies = this.instanced(car, this.body);
    const band = new BoxGeometry(2.96, 0.9, CAR_LEN - 1.2);
    band.translate(0, 2.25, 0);
    this.windows = this.instanced(band, this.glass);
    const stripe = new BoxGeometry(2.94, 0.28, CAR_LEN - 0.2);
    stripe.translate(0, 1.1, 0);
    this.stripes = this.instanced(stripe, this.stripe);
  }

  private instanced(geo: BufferGeometry, m: MeshStandardMaterial): InstancedMesh {
    const mesh = new InstancedMesh(geo, m, MAX_TRAINS * CARS);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  /** Deck heights along a line: high enough over every bump, smooth, meeting each station's platform. */
  private profile(s: GameState, l: MetroLine): Profile | null {
    const sa = s.buildings[l.a];
    const sb = s.buildings[l.b];
    if (!isStation(sa) || !isStation(sb) || l.pts.length < 4) return null;
    const n = l.pts.length / 2;
    const x: number[] = [];
    const z: number[] = [];
    const ground: number[] = [];
    const arc: number[] = [];
    let acc = 0;
    for (let i = 0; i < n; i++) {
      x.push(l.pts[i * 2]!);
      z.push(l.pts[i * 2 + 1]!);
      if (i > 0) acc += Math.hypot(x[i]! - x[i - 1]!, z[i]! - z[i - 1]!);
      arc.push(acc);
      ground.push(Math.max(0, heightAt(s.heights, x[i]!, z[i]!)));
    }
    // Clearance over the highest ground nearby, then smoothed so the deck flows.
    const want = ground.map((_, i) => {
      let m = 0;
      for (let k = Math.max(0, i - 8); k <= Math.min(n - 1, i + 8); k++) m = Math.max(m, ground[k]!);
      return m + METRO.height;
    });
    let y = want.slice();
    for (let pass = 0; pass < 3; pass++) {
      y = y.map((_, i) => {
        let sum = 0;
        let c = 0;
        for (let k = Math.max(0, i - 6); k <= Math.min(n - 1, i + 6); k++) {
          sum += y[k]!;
          c++;
        }
        return Math.max(want[i]! - 2, sum / c);
      });
    }
    // Meet the station platforms, easing in over the first and last 60 m.
    const ya = sa.baseY + METRO_DECK;
    const yb = sb.baseY + METRO_DECK;
    for (let i = 0; i < n; i++) {
      const fa = Math.max(0, 1 - arc[i]! / 60);
      const fb = Math.max(0, 1 - (acc - arc[i]!) / 60);
      const ea = fa * fa * (3 - 2 * fa);
      const eb = fb * fb * (3 - 2 * fb);
      y[i] = y[i]! * (1 - ea) * (1 - eb) + ya * ea + yb * eb * (1 - ea);
    }
    return { x, z, y, s: arc, length: acc };
  }

  /** Rebuilds every viaduct (call when lines change or a city is loaded). */
  rebuild(s: GameState): void {
    for (const m of [this.deck, this.rails, this.piers]) {
      if (m) {
        m.geometry.dispose();
        this.group.remove(m);
      }
    }
    this.deck = null;
    this.rails = null;
    this.piers = null;
    this.profiles.clear();
    this.trains = [];
    const deckGeos: BufferGeometry[] = [];
    const railGeos: BufferGeometry[] = [];
    const pierGeos: BufferGeometry[] = [];
    for (const l of s.metro?.lines ?? []) {
      if (!l) continue;
      const p = this.profile(s, l);
      if (!p) continue;
      this.profiles.set(l.id, p);
      const d = this.deckGeometry(p);
      deckGeos.push(d.girder);
      railGeos.push(d.rails);
      pierGeos.push(...this.pierGeometries(s, p));
      // Two trains per line, one on each track, half a trip apart.
      if (this.trains.length < MAX_TRAINS - 1) {
        const trip = p.length / TRAIN_SPEED + DWELL;
        this.trains.push({ line: l.id, side: 1, phase: 0 }, { line: l.id, side: -1, phase: trip });
      }
    }
    if (deckGeos.length) {
      this.deck = new Mesh(mergeGeometries(deckGeos), this.concrete);
      this.deck.castShadow = true;
      this.deck.receiveShadow = true;
      this.group.add(this.deck);
      this.rails = new Mesh(mergeGeometries(railGeos), this.steel);
      this.rails.receiveShadow = true;
      this.group.add(this.rails);
    }
    if (pierGeos.length) {
      this.piers = new Mesh(mergeGeometries(pierGeos), this.concrete);
      this.piers.castShadow = true;
      this.piers.receiveShadow = true;
      this.group.add(this.piers);
    }
    for (const g of [...deckGeos, ...railGeos, ...pierGeos]) g.dispose();
  }

  /** Box girder with parapets, and four rails, swept along the path. */
  private deckGeometry(p: Profile): { girder: BufferGeometry; rails: BufferGeometry } {
    // Cross-section corners (lateral offset, height relative to the deck top), walked round.
    const girder: Array<[number, number]> = [
      [-DECK_HALF, 0.9],
      [-DECK_HALF, 0],
      [-DECK_HALF + 0.2, -0.35],
      [-2.0, -GIRDER],
      [2.0, -GIRDER],
      [DECK_HALF - 0.2, -0.35],
      [DECK_HALF, 0],
      [DECK_HALF, 0.9],
      [DECK_HALF - 0.25, 0.9],
      [DECK_HALF - 0.25, 0.02],
      [-DECK_HALF + 0.25, 0.02],
      [-DECK_HALF + 0.25, 0.9],
    ];
    const rails: Array<Array<[number, number]>> = [];
    for (const t of [-TRACK, TRACK]) {
      for (const r of [-0.72, 0.72]) {
        const c = t + r;
        rails.push([
          [c - 0.06, 0.02],
          [c + 0.06, 0.02],
          [c + 0.06, 0.2],
          [c - 0.06, 0.2],
        ]);
      }
    }
    const sweep = (shape: Array<[number, number]>, closed: boolean, pos: number[], out: number[]): void => {
      const base = pos.length / 3;
      const m = shape.length;
      for (let i = 0; i < p.x.length; i++) {
        const i0 = Math.max(0, i - 1);
        const i1 = Math.min(p.x.length - 1, i + 1);
        let tx = p.x[i1]! - p.x[i0]!;
        let tz = p.z[i1]! - p.z[i0]!;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        // Lateral axis: right of the direction of travel.
        const lx = -tz;
        const lz = tx;
        for (const [o, h] of shape) pos.push(p.x[i]! + lx * o, p.y[i]! + h, p.z[i]! + lz * o);
      }
      const edges = closed ? m : m - 1;
      for (let i = 0; i + 1 < p.x.length; i++) {
        for (let k = 0; k < edges; k++) {
          const a = base + i * m + k;
          const b = base + i * m + ((k + 1) % m);
          const c = a + m;
          const d = b + m;
          out.push(a, c, b, b, c, d);
        }
      }
    };
    const build = (shapes: Array<Array<[number, number]>>): BufferGeometry => {
      const pos: number[] = [];
      const idx: number[] = [];
      for (const sh of shapes) sweep(sh, true, pos, idx);
      const indexed = new BufferGeometry();
      indexed.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      indexed.setIndex(idx);
      // Faceted normals: crisp edges on the girder and rails.
      const flat = indexed.toNonIndexed();
      flat.computeVertexNormals();
      indexed.dispose();
      return flat;
    };
    return { girder: build([girder]), rails: build(rails) };
  }

  /** Round piers with a hammerhead cap every ~30 m, never standing on a road or in a station. */
  private pierGeometries(s: GameState, p: Profile): BufferGeometry[] {
    const out: BufferGeometry[] = [];
    const roadAt = (x: number, z: number): boolean => {
      const i = Math.floor(x / CELL);
      const j = Math.floor(z / CELL);
      if (i < 0 || j < 0 || i >= MAP || j >= MAP) return true;
      const k = j * MAP + i;
      const b = s.buildingCell[k]!;
      return s.roadCell[k]! >= 0 || (b >= 0 && s.buildings[b]?.kind !== 0);
    };
    for (let target = PIER_EVERY / 2 + 10; target < p.length - 10; target += PIER_EVERY) {
      // Nearest sample to the target that is clear of roads and facilities.
      let best = -1;
      for (let shift = 0; shift <= 3 && best < 0; shift++) {
        for (const dir of shift === 0 ? [0] : [-1, 1]) {
          const want = target + dir * shift * 6;
          let i = p.s.findIndex((v) => v >= want);
          if (i < 0) i = p.s.length - 1;
          if (!roadAt(p.x[i]!, p.z[i]!)) {
            best = i;
            break;
          }
        }
      }
      if (best < 0) continue;
      const x = p.x[best]!;
      const z = p.z[best]!;
      const top = p.y[best]! - GIRDER;
      const ground = heightAt(s.heights, x, z) - 0.5;
      const col = new CylinderGeometry(0.85, 1.0, top - ground, 14);
      col.translate(x, (top + ground) / 2, z);
      out.push(col);
      const i0 = Math.max(0, best - 1);
      const i1 = Math.min(p.x.length - 1, best + 1);
      const ang = Math.atan2(p.x[i1]! - p.x[i0]!, p.z[i1]! - p.z[i0]!);
      const cap = new BoxGeometry(4.6, 1.1, 2.0);
      cap.rotateY(ang);
      cap.translate(x, top - 0.55, z);
      out.push(cap);
    }
    return out;
  }

  /** Where along the line a train is after `t` seconds: shuttling with a dwell at each end. */
  private trainPosition(p: Profile, t: number): number {
    const run = p.length / TRAIN_SPEED;
    const cycle = 2 * (run + DWELL);
    let u = t % cycle;
    const ease = (k: number): number => k * k * (3 - 2 * k);
    if (u < DWELL) return 0;
    u -= DWELL;
    if (u < run) return ease(u / run) * p.length;
    u -= run;
    if (u < DWELL) return p.length;
    u -= DWELL;
    return (1 - ease(u / run)) * p.length;
  }

  private sample(p: Profile, s: number, offset: number): void {
    const len = Math.max(0, Math.min(p.length, s));
    let i = p.s.findIndex((v) => v >= len);
    if (i < 0) i = p.s.length - 1;
    if (i === 0) i = 1;
    const s0 = p.s[i - 1]!;
    const s1 = p.s[i]!;
    const k = s1 > s0 ? (len - s0) / (s1 - s0) : 0;
    const x = p.x[i - 1]! + (p.x[i]! - p.x[i - 1]!) * k;
    const z = p.z[i - 1]! + (p.z[i]! - p.z[i - 1]!) * k;
    const y = p.y[i - 1]! + (p.y[i]! - p.y[i - 1]!) * k;
    fwd.set(p.x[i]! - p.x[i - 1]!, p.y[i]! - p.y[i - 1]!, p.z[i]! - p.z[i - 1]!).normalize();
    side.crossVectors(up, fwd).normalize();
    tmpP.set(x - side.x * offset, y + 0.2, z - side.z * offset);
    basis.makeBasis(side, up, fwd);
    tmpQ.setFromRotationMatrix(basis);
  }

  /** Moves the trains. `dt` is 0 while the city is paused. `night` lights the windows. */
  update(dt: number, night: number): void {
    this.time += dt;
    this.glass.emissiveIntensity = night * 1.6;
    let n = 0;
    for (const tr of this.trains) {
      const p = this.profiles.get(tr.line);
      if (!p || p.length < CAR_LEN * CARS) continue;
      const head = this.trainPosition(p, this.time + tr.phase);
      // Keep the whole train on the viaduct.
      const span = CARS * CAR_LEN + (CARS - 1) * CAR_GAP;
      const start = Math.min(p.length - span / 2, Math.max(span / 2, head));
      for (let c = 0; c < CARS; c++) {
        const s = start + (c - (CARS - 1) / 2) * (CAR_LEN + CAR_GAP);
        this.sample(p, s, tr.side * TRACK);
        tmpM.compose(tmpP, tmpQ, tmpS);
        this.bodies.setMatrixAt(n, tmpM);
        this.windows.setMatrixAt(n, tmpM);
        this.stripes.setMatrixAt(n, tmpM);
        n++;
      }
    }
    for (const m of [this.bodies, this.windows, this.stripes]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
  }

  /** A ghost of a line being drawn, green when it can be built and red when not. */
  setPreview(s: GameState, pts: readonly number[] | null, ok: boolean): void {
    if (this.preview) {
      this.preview.geometry.dispose();
      this.group.remove(this.preview);
      this.preview = null;
    }
    if (!pts || pts.length < 4) return;
    const pos: number[] = [];
    const idx: number[] = [];
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2]!;
      const z = pts[i * 2 + 1]!;
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      let tx = pts[i1 * 2]! - pts[i0 * 2]!;
      let tz = pts[i1 * 2 + 1]! - pts[i0 * 2 + 1]!;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const y = Math.max(0, heightAt(s.heights, x, z)) + METRO.height;
      pos.push(x + tz * DECK_HALF, y, z - tx * DECK_HALF, x - tz * DECK_HALF, y, z + tx * DECK_HALF);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setIndex(idx);
    this.previewMat.color.set(ok ? new Color(0.3, 0.9, 0.6) : new Color(1, 0.3, 0.25));
    this.preview = new Mesh(geo, this.previewMat);
    this.preview.renderOrder = 5;
    this.group.add(this.preview);
  }
}
