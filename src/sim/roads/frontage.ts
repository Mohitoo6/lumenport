import { MAP } from '../../core/constants';
import { FACING_DX, FACING_DY, type Building } from '../zoning/zones';

/**
 * The road cell a building opens onto: the middle of its front side if a road is there,
 * else the next cell along that side with a road, then the other sides in turn. A wide lot
 * (a campus, an IT park) may touch its road along only part of a side. Returns the cell
 * index (j * MAP + i), or -1 if no side touches a road.
 */
export function frontCell(b: Pick<Building, 'x' | 'y' | 'w' | 'h' | 'facing'>, roadCell: Int32Array): number {
  for (let k = 0; k < 4; k++) {
    const f = (b.facing + k) % 4;
    const dx = FACING_DX[f]!;
    const dy = FACING_DY[f]!;
    const n = dx === 0 ? b.w : b.h;
    // From the middle outwards: n>>1, then one either side, and so on.
    for (let step = 0; step < n; step++) {
      const t = (n >> 1) + (step % 2 === 0 ? step / 2 : -(step + 1) / 2);
      if (t < 0 || t >= n) continue;
      const i = dx === 0 ? b.x + t : dx < 0 ? b.x - 1 : b.x + b.w;
      const j = dy === 0 ? b.y + t : dy < 0 ? b.y - 1 : b.y + b.h;
      if (i < 0 || j < 0 || i >= MAP || j >= MAP) continue;
      const cell = j * MAP + i;
      if (roadCell[cell]! >= 0) return cell;
    }
  }
  return -1;
}
