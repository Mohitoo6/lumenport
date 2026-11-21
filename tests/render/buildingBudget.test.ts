import { describe, expect, it } from 'vitest';
import { generateBuilding } from '../../src/render/buildings/generate';
import { FacilityKind } from '../../src/sim/facilities';
import { Facing, ZoneType, zoneCode, type Building } from '../../src/sim/zoning/zones';

const lot = (w: number, h: number, density: number, level: number, seed: number): Building => ({
  id: 1, kind: 0, zone: zoneCode(ZoneType.Residential, density as 1 | 2 | 3), x: 10, y: 10, w, h,
  facing: Facing.South, level, progress: 1, seed, baseY: 0, pop: 10, flags: 0,
});

describe('residential buildings', () => {
  it('stay inside their triangle budget and are the same every time for one seed', () => {
    const report: string[] = [];
    for (const density of [1, 2, 3]) {
      for (const level of [1, 2, 3]) {
        let max = 0;
        let sum = 0;
        let n = 0;
        for (const [w, h] of [[1, 1], [1, 2], [2, 2], [2, 3], [3, 3], [4, 4]] as const) {
          for (let s = 0; s < 40; s++) {
            const b = lot(w, h, density, level, 1000 + s * 7919);
            const g = generateBuilding(b);
            const tris = g.idx.length / 3;
            max = Math.max(max, tris);
            sum += tris;
            n++;
            if (s < 3) expect(generateBuilding(b).pos).toEqual(g.pos);
            for (const v of g.pos) expect(Number.isFinite(v)).toBe(true);
          }
        }
        report.push(`density ${density} level ${level}: avg ${Math.round(sum / n)} max ${max}`);
        expect(max).toBeLessThan(density === 3 ? 4000 : 2000);
      }
    }
    console.log(report.join('\n'));
  }, 120_000);
});

describe('the hospital', () => {
  it('fits its budget either way round and is the same every time for one seed', () => {
    for (const [w, h, facing] of [[5, 6, Facing.South], [6, 5, Facing.South], [5, 6, Facing.East]] as const) {
      for (let s = 0; s < 12; s++) {
        const b: Building = { id: 1, kind: FacilityKind.Hospital, zone: 0, x: 10, y: 10, w, h, facing, level: 1, progress: 1, seed: 77 + s * 104729, baseY: 0, pop: 0, flags: 0 };
        const g = generateBuilding(b);
        expect(g.idx.length / 3).toBeLessThan(8000);
        expect(generateBuilding(b).pos).toEqual(g.pos);
        // Everything stays inside the lot (5 by 6 cells of 8 m around its centre).
        const cx = (b.x + w / 2) * 8;
        const cz = (b.y + h / 2) * 8;
        for (let i = 0; i < g.pos.length; i += 3) {
          expect(Math.abs(g.pos[i]! - cx)).toBeLessThanOrEqual((w * 8) / 2 + 0.01);
          expect(Math.abs(g.pos[i + 2]! - cz)).toBeLessThanOrEqual((h * 8) / 2 + 0.01);
        }
      }
    }
  });
});

describe('the cricket ground', () => {
  it('fits its budget facing any way, stays in its lot and is the same every time for one seed', () => {
    for (const facing of [Facing.North, Facing.East, Facing.South, Facing.West]) {
      for (let s = 0; s < 6; s++) {
        const b: Building = { id: 1, kind: FacilityKind.SportsGround, zone: 0, x: 20, y: 20, w: 12, h: 12, facing, level: 1, progress: 1, seed: 31 + s * 7919, baseY: 0, pop: 0, flags: 0 };
        const g = generateBuilding(b);
        const tris = g.idx.length / 3;
        expect(tris).toBeLessThan(9000);
        if (s === 0 && facing === Facing.South) console.log(`cricket ground: ${tris} triangles`);
        expect(generateBuilding(b).pos).toEqual(g.pos);
        const c = (20 + 6) * 8;
        for (let i = 0; i < g.pos.length; i += 3) {
          expect(Math.abs(g.pos[i]! - c)).toBeLessThanOrEqual(48.01);
          expect(Math.abs(g.pos[i + 2]! - c)).toBeLessThanOrEqual(48.01);
        }
      }
    }
  });
});

describe('the mall, multiplex and bazaar', () => {
  it('fit their budgets, stay in their lots and are the same every time for one seed', () => {
    const cases: Array<[number, number, number, number]> = [
      [FacilityKind.ShoppingMall, 10, 8, 10000],
      [FacilityKind.ShoppingMall, 8, 10, 10000],
      [FacilityKind.Multiplex, 4, 4, 4000],
      [FacilityKind.MarketStreet, 4, 2, 4000],
      [FacilityKind.MarketStreet, 2, 4, 4000],
    ];
    for (const [kind, w, h, budget] of cases) {
      for (const facing of [Facing.North, Facing.East, Facing.South, Facing.West]) {
        for (let s = 0; s < 4; s++) {
          const b: Building = { id: 1, kind, zone: 0, x: 20, y: 20, w, h, facing, level: 1, progress: 1, seed: 11 + s * 6151, baseY: 0, pop: 0, flags: 0 };
          const g = generateBuilding(b);
          const tris = g.idx.length / 3;
          expect(tris, `kind ${kind}`).toBeLessThan(budget);
          if (s === 0 && facing === Facing.South) console.log(`kind ${kind} ${w}x${h}: ${tris} triangles`);
          expect(generateBuilding(b).pos).toEqual(g.pos);
          const cx = (20 + w / 2) * 8;
          const cz = (20 + h / 2) * 8;
          for (let i = 0; i < g.pos.length; i += 3) {
            expect(Math.abs(g.pos[i]! - cx), `kind ${kind} x`).toBeLessThanOrEqual((w * 8) / 2 + 0.01);
            expect(Math.abs(g.pos[i + 2]! - cz), `kind ${kind} z`).toBeLessThanOrEqual((h * 8) / 2 + 0.01);
            expect(Number.isFinite(g.pos[i + 1]!)).toBe(true);
          }
        }
      }
    }
  });
});

describe('commercial buildings', () => {
  it('stay inside their triangle budget, are finite and are the same every time for one seed', () => {
    const report: string[] = [];
    for (const density of [1, 2, 3] as const) {
      for (const level of [1, 2, 3]) {
        let max = 0;
        for (const [w, h] of [[1, 1], [1, 2], [2, 1], [2, 2], [2, 3], [3, 3], [4, 4]] as const) {
          for (let s = 0; s < 25; s++) {
            const b: Building = { id: 1, kind: 0, zone: zoneCode(ZoneType.Commercial, density), x: 10, y: 10, w, h, facing: Facing.South, level, progress: 1, seed: 500 + s * 7919, baseY: 0, pop: 10, flags: 0 };
            const g = generateBuilding(b);
            max = Math.max(max, g.idx.length / 3);
            if (s < 3) expect(generateBuilding(b).pos).toEqual(g.pos);
            for (const v of g.pos) expect(Number.isFinite(v)).toBe(true);
          }
        }
        report.push(`commercial density ${density} level ${level}: max ${max}`);
        expect(max).toBeLessThan(density === 3 ? 4000 : 2000);
      }
    }
    console.log(report.join('\n'));
  }, 120_000);
});
