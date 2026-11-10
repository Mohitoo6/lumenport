import { describe, expect, it } from 'vitest';
import { CELL, MAP, VERTS, WORLD } from '../../src/core/constants';
import { generateHeights, heightAt, terrainHeight } from '../../src/sim/map/terrain';
import { generateTrees, treeCount, treeInstances, type TreeInstance } from '../../src/sim/map/trees';

describe('terrain', () => {
  const seed = 1337;
  const heights = generateHeights(seed);

  it('is deterministic for a seed', () => {
    expect(Array.from(generateHeights(seed).subarray(0, 500))).toEqual(Array.from(heights.subarray(0, 500)));
    expect(generateHeights(seed + 1)[5000]).not.toBe(heights[5000]);
  });

  it('has the right size and finite values', () => {
    expect(heights.length).toBe(VERTS * VERTS);
    for (const h of heights) expect(Number.isFinite(h)).toBe(true);
  });

  it('matches the analytic function at vertices and interpolates between them', () => {
    expect(heightAt(heights, 40 * CELL, 60 * CELL)).toBeCloseTo(terrainHeight(40 * CELL, 60 * CELL, seed), 3);
    const a = heightAt(heights, 40 * CELL, 60 * CELL);
    const b = heightAt(heights, 41 * CELL, 60 * CELL);
    expect(heightAt(heights, 40.5 * CELL, 60 * CELL)).toBeCloseTo((a + b) / 2, 4);
  });

  it('clamps lookups outside the map', () => {
    expect(heightAt(heights, -50, -50)).toBe(heights[0]);
    expect(heightAt(heights, WORLD + 99, WORLD + 99)).toBe(heights[VERTS * VERTS - 1]);
  });

  it('has water, and mostly buildable land in the middle', () => {
    let wet = 0;
    let centreDry = 0;
    let centreTotal = 0;
    for (let j = 0; j < VERTS; j++) {
      for (let i = 0; i < VERTS; i++) {
        const h = heights[j * VERTS + i]!;
        if (h < 0) wet++;
        if (Math.hypot(i - MAP / 2, j - MAP / 2) < 70) {
          centreTotal++;
          if (h > 0.5 && h < 25) centreDry++;
        }
      }
    }
    expect(wet / heights.length).toBeGreaterThan(0.02);
    expect(wet / heights.length).toBeLessThan(0.3);
    expect(centreDry / centreTotal).toBeGreaterThan(0.6);
  });
});

describe('trees', () => {
  const heights = generateHeights(1337);
  const trees = generateTrees(heights, 1337);

  it('never grows in water', () => {
    for (let j = 0; j < MAP; j++) {
      for (let i = 0; i < MAP; i++) {
        if (trees[j * MAP + i]! === 0) continue;
        expect(heightAt(heights, (i + 0.5) * CELL, (j + 0.5) * CELL)).toBeGreaterThan(0);
      }
    }
  });

  it('produces a plausible number of trees', () => {
    let n = 0;
    for (const c of trees) n += treeCount(c);
    expect(n).toBeGreaterThan(3000);
    expect(n).toBeLessThan(40000);
  });

  it('expands a cell into instances inside that cell', () => {
    const out: TreeInstance[] = [];
    const code = 2 | (1 << 2) | (9 << 4);
    treeInstances(code, 10, 20, out);
    expect(out.length).toBe(2);
    for (const t of out) {
      expect(t.x).toBeGreaterThanOrEqual(10 * CELL);
      expect(t.x).toBeLessThanOrEqual(11 * CELL);
      expect(t.z).toBeGreaterThanOrEqual(20 * CELL);
      expect(t.z).toBeLessThanOrEqual(21 * CELL);
      expect(t.species).toBe(1);
    }
  });
});
