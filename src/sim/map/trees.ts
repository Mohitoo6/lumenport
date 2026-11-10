import { CELL, MAP } from '../../core/constants';
import { smoothstep } from '../../core/math';
import { fbm } from '../../core/noise';
import { hash2 } from '../../core/rng';
import { cellMinHeight, cellRelief } from './terrain';

/**
 * Trees are stored one byte per cell so they are cheap to save and to clear when
 * something is built. Exact positions are derived from the cell hash by `treeInstances`.
 *
 *   bits 0-1  count (0 = no trees, 1..3)
 *   bits 2-3  species (see TreeSpecies)
 *   bits 4-7  size variation
 */
export const enum TreeSpecies {
  Oak = 0,
  Birch = 1,
  Pine = 2,
  Poplar = 3,
}

export const TREE_SPECIES_COUNT = 4;

export function treeCount(code: number): number {
  return code & 3;
}

export function treeSpecies(code: number): TreeSpecies {
  return ((code >> 2) & 3) as TreeSpecies;
}

export function generateTrees(heights: Float32Array, seed: number): Uint8Array {
  const out = new Uint8Array(MAP * MAP);
  for (let j = 0; j < MAP; j++) {
    for (let i = 0; i < MAP; i++) {
      const lo = cellMinHeight(heights, i, j);
      if (lo < 0.9) continue; // water and beach
      const relief = cellRelief(heights, i, j);
      if (relief > 5.5) continue; // cliffs
      const x = (i + 0.5) * CELL;
      const z = (j + 0.5) * CELL;

      // Forest patches from low-frequency noise, thicker on higher ground.
      const forest = fbm(x / 380, z / 380, seed + 71, 3);
      const upland = smoothstep(14, 40, lo);
      let density = 0.012 + smoothstep(0.08, 0.42, forest + upland * 0.35) * 0.62;
      // A thin line of trees along the water's edge.
      density += smoothstep(4.5, 1.2, lo) * 0.16;
      // Break forests up with small clearings.
      density *= 0.55 + 0.45 * smoothstep(-0.35, 0.1, fbm(x / 70, z / 70, seed + 73, 2));

      const r = hash2(i, j, seed + 79);
      if (r >= density) continue;

      const pick = hash2(i, j, seed + 83);
      let species: TreeSpecies;
      const pineBias = upland * 0.75 + smoothstep(0.1, 0.5, fbm(x / 520, z / 520, seed + 89, 2)) * 0.35;
      if (pick < pineBias) species = TreeSpecies.Pine;
      else if (pick < pineBias + 0.16) species = TreeSpecies.Birch;
      else if (pick < pineBias + 0.24 && lo < 6) species = TreeSpecies.Poplar;
      else species = TreeSpecies.Oak;

      const dense = density > 0.35;
      const count = dense ? 1 + Math.floor(hash2(i, j, seed + 97) * 2.2) : 1;
      const size = Math.floor(hash2(i, j, seed + 101) * 16);
      out[j * MAP + i] = Math.min(count, 3) | (species << 2) | (size << 4);
    }
  }
  return out;
}

export interface TreeInstance {
  x: number;
  z: number;
  species: TreeSpecies;
  scale: number;
  rotation: number;
  /** 0..1, stable per tree; used for colour variation and sway phase. */
  tint: number;
}

/** Expands one cell's tree byte into world-space instances. Deterministic for a given cell. */
export function treeInstances(code: number, i: number, j: number, out: TreeInstance[]): void {
  const n = treeCount(code);
  if (n === 0) return;
  const species = treeSpecies(code);
  const sizeVar = (code >> 4) / 15;
  for (let k = 0; k < n; k++) {
    const hx = hash2(i * 4 + k, j, 1301);
    const hz = hash2(i, j * 4 + k, 1303);
    // Keep trees inside the cell with a small margin; spread multiples apart.
    const ox = n === 1 ? 0.25 + hx * 0.5 : 0.12 + ((k + hx * 0.8) / n) * 0.76;
    const oz = 0.15 + hz * 0.7;
    out.push({
      x: (i + ox) * CELL,
      z: (j + oz) * CELL,
      species,
      scale: 0.72 + sizeVar * 0.5 + hash2(i + k, j - k, 1307) * 0.22,
      rotation: hash2(i - k, j + k, 1309) * Math.PI * 2,
      tint: hash2(i + 3 * k, j + 7 * k, 1311),
    });
  }
}
