import { MAP, VERTS } from '../../core/constants';
import { clamp } from '../../core/math';
import { NEUTRAL_TAX } from '../economy/economy';
import { FACILITIES, FacilityKind, Service } from '../facilities';
import type { RoadNetwork } from '../roads/types';
import { POWERED, WATERED } from '../utilities/network';
import { ZoneType, zoneDensity, zoneType, type Building } from '../zoning/zones';

const N = MAP * MAP;

/**
 * City-wide data layers, one value in 0..1 per cell. They are recomputed from scratch
 * from the current city (not accumulated over time), so they are deterministic and need
 * not be saved.
 */
export class Fields {
  /** Coverage per service, indexed by Service (1..5). Index 0 is unused. */
  readonly coverage: Float32Array[] = [];
  readonly pollution = new Float32Array(N);
  readonly crime = new Float32Array(N);
  readonly landValue = new Float32Array(N);
  /** Happiness of the home on each cell (0 where there is none). */
  readonly happiness = new Float32Array(N);
  /** Closeness to open water, 1 at the shore falling to 0 about 100 m inland. */
  readonly waterside = new Float32Array(N);
  private readonly tmp = new Float32Array(N);
  private watersideFor: Float32Array | null = null;

  constructor() {
    for (let i = 0; i <= 7; i++) this.coverage.push(new Float32Array(N));
  }

  /** Box blur of radius r, applied horizontally then vertically, `passes` times. */
  private blur(a: Float32Array, r: number, passes: number): void {
    const t = this.tmp;
    const w = 2 * r + 1;
    for (let p = 0; p < passes; p++) {
      for (let j = 0; j < MAP; j++) {
        const row = j * MAP;
        let sum = 0;
        for (let i = -r; i <= r; i++) sum += a[row + clamp(i, 0, MAP - 1)]!;
        for (let i = 0; i < MAP; i++) {
          t[row + i] = sum / w;
          sum += a[row + Math.min(MAP - 1, i + r + 1)]! - a[row + Math.max(0, i - r)]!;
        }
      }
      for (let i = 0; i < MAP; i++) {
        let sum = 0;
        for (let j = -r; j <= r; j++) sum += t[clamp(j, 0, MAP - 1) * MAP + i]!;
        for (let j = 0; j < MAP; j++) {
          a[j * MAP + i] = sum / w;
          sum += t[Math.min(MAP - 1, j + r + 1) * MAP + i]! - t[Math.max(0, j - r) * MAP + i]!;
        }
      }
    }
  }

  private computeWaterside(heights: Float32Array): void {
    const a = this.waterside;
    for (let j = 0; j < MAP; j++) {
      for (let i = 0; i < MAP; i++) a[j * MAP + i] = heights[j * VERTS + i]! < -0.3 ? 1 : 0;
    }
    this.blur(a, 6, 2);
    for (let k = 0; k < N; k++) a[k] = clamp(a[k]! * 3, 0, 1);
    this.watersideFor = heights;
  }

  /** Adds `amount` to every cell of a building's lot. */
  private stampLot(a: Float32Array, b: Building, amount: number): void {
    for (let j = b.y; j < b.y + b.h; j++) for (let i = b.x; i < b.x + b.w; i++) a[j * MAP + i]! += amount;
  }

  /** Raises coverage to 1 at the facility, falling linearly to 0 at `radius` cells. */
  private stampCoverage(a: Float32Array, b: Building, radius: number): void {
    const cx = b.x + b.w / 2 - 0.5;
    const cy = b.y + b.h / 2 - 0.5;
    const i0 = Math.max(0, Math.floor(cx - radius));
    const i1 = Math.min(MAP - 1, Math.ceil(cx + radius));
    const j0 = Math.max(0, Math.floor(cy - radius));
    const j1 = Math.min(MAP - 1, Math.ceil(cy + radius));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const v = 1 - Math.hypot(i - cx, j - cy) / radius;
        if (v > a[j * MAP + i]!) a[j * MAP + i] = v;
      }
    }
  }

  /**
   * Recomputes every layer. `edgeDensity` is cars per 100 m on each road edge.
   * Returns the resident-weighted average happiness.
   */
  update(
    buildings: ReadonlyArray<Building | null>,
    roads: RoadNetwork,
    roadCell: Int32Array,
    heights: Float32Array,
    edgeDensity: Float32Array,
    tax: readonly number[],
    unemployment: number,
    congestion: number,
    transitActive?: ReadonlySet<number>,
  ): number {
    if (this.watersideFor !== heights) this.computeWaterside(heights);
    for (const c of this.coverage) c.fill(0);
    const pol = this.pollution;
    const crime = this.crime;
    pol.fill(0);
    crime.fill(0);

    for (const b of buildings) {
      if (!b || b.progress < 1) continue;
      if (b.kind !== 0) {
        const spec = FACILITIES[b.kind]!;
        // A metro station or bus stop only serves anyone once a line runs through it.
        const live = (spec.service !== Service.Transit && spec.service !== Service.Bus) || (transitActive?.has(b.id) ?? false);
        if (spec.service !== Service.None && live) this.stampCoverage(this.coverage[spec.service]!, b, spec.radius);
        if (b.kind === FacilityKind.CoalPlant) this.stampLot(pol, b, 5);
        // Aircraft noise: the runway side of an airport is no place for homes.
        if (b.kind === FacilityKind.Airport) this.stampLot(pol, b, 0.9);
        continue;
      }
      const t = zoneType(b.zone);
      const d = zoneDensity(b.zone);
      const busy = b.pop / (b.w * b.h);
      if (t === ZoneType.Industrial) this.stampLot(pol, b, 1.1 + d * 0.9);
      // Crime follows people: busiest around shops and dense housing.
      this.stampLot(crime, b, busy * (t === ZoneType.Residential ? 0.012 : 0.03));
    }
    // Traffic fumes along busy roads.
    for (let k = 0; k < N; k++) {
      const e = roadCell[k]!;
      if (e >= 0 && roads.edges[e]) pol[k]! += (edgeDensity[e] ?? 0) * 0.05;
    }
    this.blur(pol, 4, 2);
    this.blur(crime, 5, 2);
    const police = this.coverage[Service.Police]!;
    for (let k = 0; k < N; k++) {
      pol[k] = clamp(pol[k]! * 1.6, 0, 1);
      crime[k] = clamp(crime[k]! * 1.5 * (1 - 0.85 * police[k]!), 0, 1);
    }

    const fire = this.coverage[Service.Fire]!;
    const health = this.coverage[Service.Health]!;
    const edu = this.coverage[Service.Education]!;
    const park = this.coverage[Service.Park]!;
    const transit = this.coverage[Service.Transit]!;
    const lv = this.landValue;
    for (let k = 0; k < N; k++) {
      lv[k] = clamp(
        0.42 + 0.22 * this.waterside[k]! + 0.2 * park[k]! + 0.06 * (police[k]! + fire[k]! + health[k]! + edu[k]!) + 0.12 * transit[k]! - 0.55 * pol[k]! - 0.35 * crime[k]!,
        0,
        1,
      );
    }

    // Happiness per home.
    const hap = this.happiness;
    hap.fill(0);
    let weighted = 0;
    let people = 0;
    const taxPenalty = (tax[1]! - NEUTRAL_TAX) * 0.02;
    for (const b of buildings) {
      if (!b || b.kind !== 0 || b.progress < 1 || zoneType(b.zone) !== ZoneType.Residential) continue;
      const k = (b.y + (b.h >> 1)) * MAP + b.x + (b.w >> 1);
      const served = (b.flags & (POWERED | WATERED)) === (POWERED | WATERED);
      const h = clamp(
        0.56 +
          0.3 * (lv[k]! - 0.42) +
          0.12 * health[k]! +
          0.1 * edu[k]! +
          0.06 * transit[k]! +
          0.07 * police[k]! +
          0.05 * fire[k]! -
          0.35 * pol[k]! -
          0.25 * crime[k]! -
          0.3 * unemployment -
          0.1 * congestion -
          taxPenalty -
          (served ? 0 : 0.3),
        0,
        1,
      );
      this.stampLot(hap, b, h);
      weighted += h * b.pop;
      people += b.pop;
    }
    return people > 0 ? weighted / people : 0.5;
  }
}
