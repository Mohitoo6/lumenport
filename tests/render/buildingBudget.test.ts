import { describe, expect, it } from 'vitest';
import { generateBuilding } from '../../src/render/buildings/generate';
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
  });
});
