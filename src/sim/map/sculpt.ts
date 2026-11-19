import { CELL, MAP, VERTS } from '../../core/constants';

export type SculptMode = 'raise' | 'lower' | 'flatten' | 'smooth';

export const SCULPT = {
  /** Brush radii the tool offers, metres. */
  radii: [24, 40, 64] as const,
  /** Metres the centre of the brush moves per full-strength stroke. */
  rate: 0.6,
  /** No hill higher than this, metres above the water. */
  maxHeight: 70,
  /** Lowering stops here, so the brush never makes new water. */
  minLand: 1.2,
  /** Ground below this is water or beach and is left alone. */
  shore: 0.5,
  /** Steepest step between neighbouring vertices, metres per cell (8 m): about 40%. */
  maxStep: 3.2,
  /** Price of earthworks, dollars per cubic metre moved. */
  costPerM3: 0.04,
};

export interface SculptRequest {
  x: number;
  z: number;
  radius: number;
  mode: SculptMode;
  /** 0..1 share of a full stroke. */
  strength: number;
  /** Height to flatten towards (flatten only). */
  target?: number;
}

export interface SculptResult {
  /** Vertex rectangle that changed (inclusive), or null if nothing did. */
  rect: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Cubic metres of earth moved. */
  volume: number;
  cost: number;
}

/**
 * Plans one stroke of the terrain brush on a copy of the ground it touches. Vertices under
 * roads and building pads (and the ring around them) do not move, nor do water and beach,
 * so a hill raised next to a road banks up from it instead of burying it. Slopes are kept
 * walkable: no step steeper than `SCULPT.maxStep` between neighbours.
 *
 * Returns the new heights for the rectangle; `commitSculpt` writes them.
 */
export interface SculptPlan {
  result: SculptResult;
  /** New heights for the vertex rectangle starting at (i0, j0), `w` wide. */
  patch: Float32Array;
  w: number;
  i0: number;
  j0: number;
}

export function planSculpt(heights: Float32Array, lock: Uint8Array, req: SculptRequest, keepOut: ReadonlyArray<{ x: number; z: number; r: number }> = []): SculptPlan {
  const r = Math.max(CELL, req.radius);
  const i0 = Math.max(1, Math.floor((req.x - r) / CELL));
  const j0 = Math.max(1, Math.floor((req.z - r) / CELL));
  const i1 = Math.min(MAP - 1, Math.ceil((req.x + r) / CELL));
  const j1 = Math.min(MAP - 1, Math.ceil((req.z + r) / CELL));
  const w = i1 - i0 + 1;
  const h = j1 - j0 + 1;
  const empty: SculptPlan = { result: { rect: null, volume: 0, cost: 0 }, patch: new Float32Array(0), w: 0, i0, j0 };
  if (w <= 0 || h <= 0) return empty;
  const patch = new Float32Array(w * h);
  const fixed = new Uint8Array(w * h);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const p = (j - j0) * w + (i - i0);
      const k = j * VERTS + i;
      patch[p] = heights[k]!;
      let held = heights[k]! < SCULPT.shore;
      // A vertex beside a road or pad holds too, so the kerb and the lot edge stay put.
      for (let dj = -1; dj <= 1 && !held; dj++) for (let di = -1; di <= 1 && !held; di++) if (lock[(j + dj) * VERTS + i + di]) held = true;
      for (const o of keepOut) if (!held && Math.hypot(i * CELL - o.x, j * CELL - o.z) < o.r) held = true;
      fixed[p] = held ? 1 : 0;
    }
  }
  const at = (i: number, j: number): number => (i >= i0 && i <= i1 && j >= j0 && j <= j1 ? patch[(j - j0) * w + (i - i0)]! : heights[j * VERTS + i]!);
  const before = patch.slice();
  const s = Math.max(0, Math.min(1, req.strength));
  // Smooth reads the ground as it was, not as it is being rewritten.
  const avg = (i: number, j: number): number => {
    let sum = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) sum += heights[(j + dj) * VERTS + i + di]!;
    return sum / 9;
  };
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const p = (j - j0) * w + (i - i0);
      if (fixed[p]) continue;
      const d = Math.hypot(i * CELL - req.x, j * CELL - req.z) / r;
      if (d >= 1) continue;
      // A smooth dome: full at the centre, nothing at the rim.
      const f = 0.5 + 0.5 * Math.cos(Math.PI * d);
      const cur = patch[p]!;
      let next = cur;
      switch (req.mode) {
        case 'raise':
          next = Math.min(SCULPT.maxHeight, cur + SCULPT.rate * s * f);
          break;
        case 'lower':
          next = cur <= SCULPT.minLand ? cur : Math.max(SCULPT.minLand, cur - SCULPT.rate * s * f);
          break;
        case 'flatten': {
          const t = Math.max(SCULPT.minLand, Math.min(SCULPT.maxHeight, req.target ?? cur));
          next = cur + (t - cur) * Math.min(1, f * 0.6 * s);
          break;
        }
        case 'smooth':
          next = cur + (avg(i, j) - cur) * Math.min(1, f * 0.8 * s);
          break;
      }
      patch[p] = next;
    }
  }
  // Keep slopes walkable: a few passes pulling each moved vertex within a step of its neighbours.
  for (let pass = 0; pass < 4; pass++) {
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const p = (j - j0) * w + (i - i0);
        if (fixed[p] || patch[p] === before[p]) continue;
        let hi = Infinity;
        let lo = -Infinity;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (di === 0 && dj === 0) continue;
            const step = SCULPT.maxStep * (di !== 0 && dj !== 0 ? Math.SQRT2 : 1);
            const n = at(i + di, j + dj);
            hi = Math.min(hi, n + step);
            lo = Math.max(lo, n - step);
          }
        }
        // Only ever hold a stroke back, never push past where the ground started.
        const v = patch[p]!;
        if (v > before[p]! && v > hi) patch[p] = Math.max(before[p]!, hi);
        else if (v < before[p]! && v < lo) patch[p] = Math.min(before[p]!, lo);
      }
    }
  }
  let volume = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const p = (j - j0) * w + (i - i0);
      const dh = Math.abs(patch[p]! - before[p]!);
      if (dh < 1e-4) {
        patch[p] = before[p]!;
        continue;
      }
      volume += dh * CELL * CELL;
      x0 = Math.min(x0, i);
      y0 = Math.min(y0, j);
      x1 = Math.max(x1, i);
      y1 = Math.max(y1, j);
    }
  }
  if (volume === 0) return empty;
  return { result: { rect: { x0, y0, x1, y1 }, volume, cost: Math.round(volume * SCULPT.costPerM3) }, patch, w, i0, j0 };
}

/** Writes a planned stroke into the height field. */
export function commitSculpt(heights: Float32Array, plan: SculptPlan): void {
  if (plan.w === 0) return;
  const rows = plan.patch.length / plan.w;
  for (let j = 0; j < rows; j++) for (let i = 0; i < plan.w; i++) heights[(plan.j0 + j) * VERTS + plan.i0 + i] = plan.patch[j * plan.w + i]!;
}
