import { MAP } from '../../core/constants';
import { cellMinHeight } from '../map/terrain';
import { MAX_DEPTH } from './lots';
import { FACING_DX, FACING_DY } from './zones';

export interface AlongLayers {
  zone: Uint8Array;
  roadCell: Int32Array;
  buildingCell: Int32Array;
  heights: Float32Array;
}

/**
 * The cells to paint when zoning along road edges: every free cell that a lot facing one
 * of those roads could reach (up to MAX_DEPTH back, stopping at the next road), whatever
 * the road's angle or shape. Cells with buildings are left alone, so dragging along a
 * developed street never demolishes anything.
 */
export function zoneAlongCells(s: AlongLayers, edges: readonly number[], zone: number): number[] {
  const want = new Set(edges);
  const out = new Set<number>();
  if (want.size === 0) return [];
  for (let j = 1; j < MAP - 1; j++) {
    for (let i = 1; i < MAP - 1; i++) {
      const id = s.roadCell[j * MAP + i]!;
      if (id < 0 || !want.has(id)) continue;
      for (let f = 0; f < 4; f++) {
        const dx = FACING_DX[f]!;
        const dy = FACING_DY[f]!;
        for (let d = 1; d <= MAX_DEPTH; d++) {
          const x = i - dx * d;
          const y = j - dy * d;
          if (x < 1 || y < 1 || x >= MAP - 1 || y >= MAP - 1) break;
          const k = y * MAP + x;
          if (s.roadCell[k]! >= 0) break;
          if (s.buildingCell[k]! >= 0 || s.zone[k] === zone) continue;
          if (zone === 0 ? s.zone[k] === 0 : cellMinHeight(s.heights, x, y) < 0.5) continue;
          out.add(k);
        }
      }
    }
  }
  return [...out];
}
