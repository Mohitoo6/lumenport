/** 2D curve helpers on the ground plane (x, z). Pure math, shared with the renderer. */

export interface Pt {
  x: number;
  z: number;
}

export function bezX(a: number, c: number, b: number, t: number): number {
  const u = 1 - t;
  return u * u * a + 2 * u * t * c + t * t * b;
}

export function bezPoint(ax: number, az: number, cx: number, cz: number, bx: number, bz: number, t: number, out: Pt): Pt {
  out.x = bezX(ax, cx, bx, t);
  out.z = bezX(az, cz, bz, t);
  return out;
}

/** Unnormalised derivative of the curve at t. */
export function bezTangent(ax: number, az: number, cx: number, cz: number, bx: number, bz: number, t: number, out: Pt): Pt {
  out.x = 2 * (1 - t) * (cx - ax) + 2 * t * (bx - cx);
  out.z = 2 * (1 - t) * (cz - az) + 2 * t * (bz - cz);
  return out;
}

export function bezLength(ax: number, az: number, cx: number, cz: number, bx: number, bz: number, steps = 24): number {
  let len = 0;
  let px = ax;
  let pz = az;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = bezX(ax, cx, bx, t);
    const z = bezX(az, cz, bz, t);
    len += Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
  }
  return len;
}

/**
 * A curve flattened to line segments. Arrays are parallel: point i is (x[i], z[i]) at
 * Bezier parameter t[i] and arc length s[i] from the start.
 */
export interface Polyline {
  n: number;
  x: Float64Array;
  z: Float64Array;
  t: Float64Array;
  s: Float64Array;
  length: number;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function flatten(ax: number, az: number, cx: number, cz: number, bx: number, bz: number, step: number, straight = false): Polyline {
  const approx = straight ? Math.hypot(bx - ax, bz - az) : bezLength(ax, az, cx, cz, bx, bz, 12);
  const n = Math.max(2, Math.ceil(approx / step) + 1);
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  const t = new Float64Array(n);
  const s = new Float64Array(n);
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const ti = i / (n - 1);
    t[i] = ti;
    x[i] = bezX(ax, cx, bx, ti);
    z[i] = bezX(az, cz, bz, ti);
    if (i > 0) s[i] = s[i - 1]! + Math.hypot(x[i]! - x[i - 1]!, z[i]! - z[i - 1]!);
    if (x[i]! < minX) minX = x[i]!;
    if (x[i]! > maxX) maxX = x[i]!;
    if (z[i]! < minZ) minZ = z[i]!;
    if (z[i]! > maxZ) maxZ = z[i]!;
  }
  return { n, x, z, t, s, length: s[n - 1]!, minX, minZ, maxX, maxZ };
}

export interface Closest {
  dist: number;
  x: number;
  z: number;
  /** Bezier parameter of the closest point. */
  t: number;
  /** Arc length of the closest point. */
  s: number;
}

/** Closest point on a polyline to (px, pz). Writes into `out` and returns it. */
export function closestOnPolyline(p: Polyline, px: number, pz: number, out: Closest): Closest {
  let best = Infinity;
  for (let i = 0; i < p.n - 1; i++) {
    const x0 = p.x[i]!;
    const z0 = p.z[i]!;
    const dx = p.x[i + 1]! - x0;
    const dz = p.z[i + 1]! - z0;
    const len2 = dx * dx + dz * dz;
    let k = len2 > 0 ? ((px - x0) * dx + (pz - z0) * dz) / len2 : 0;
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    const qx = x0 + dx * k;
    const qz = z0 + dz * k;
    const d2 = (px - qx) * (px - qx) + (pz - qz) * (pz - qz);
    if (d2 < best) {
      best = d2;
      out.x = qx;
      out.z = qz;
      out.t = p.t[i]! + (p.t[i + 1]! - p.t[i]!) * k;
      out.s = p.s[i]! + (p.s[i + 1]! - p.s[i]!) * k;
    }
  }
  out.dist = Math.sqrt(best);
  return out;
}

export function newClosest(): Closest {
  return { dist: Infinity, x: 0, z: 0, t: 0, s: 0 };
}

export interface Crossing {
  /** Bezier parameter on the first polyline. */
  tA: number;
  /** Bezier parameter on the second polyline. */
  tB: number;
  x: number;
  z: number;
}

/** All proper crossings between two polylines. */
export function crossings(a: Polyline, b: Polyline, out: Crossing[]): Crossing[] {
  if (a.maxX < b.minX || b.maxX < a.minX || a.maxZ < b.minZ || b.maxZ < a.minZ) return out;
  for (let i = 0; i < a.n - 1; i++) {
    const ax = a.x[i]!;
    const az = a.z[i]!;
    const adx = a.x[i + 1]! - ax;
    const adz = a.z[i + 1]! - az;
    for (let j = 0; j < b.n - 1; j++) {
      const bx = b.x[j]!;
      const bz = b.z[j]!;
      const bdx = b.x[j + 1]! - bx;
      const bdz = b.z[j + 1]! - bz;
      const den = adx * bdz - adz * bdx;
      if (Math.abs(den) < 1e-9) continue;
      const u = ((bx - ax) * bdz - (bz - az) * bdx) / den;
      const v = ((bx - ax) * adz - (bz - az) * adx) / den;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      // A crossing exactly on a shared vertex is reported by both neighbouring segments.
      const x = ax + adx * u;
      const z = az + adz * u;
      const last = out[out.length - 1];
      if (last && Math.hypot(last.x - x, last.z - z) < 1e-6) continue;
      out.push({ tA: a.t[i]! + (a.t[i + 1]! - a.t[i]!) * u, tB: b.t[j]! + (b.t[j + 1]! - b.t[j]!) * v, x, z });
    }
  }
  return out;
}

/** Control point of the sub-curve of a quadratic Bezier between parameters t0 and t1. */
export function subControl(a: number, c: number, b: number, t0: number, t1: number): number {
  // Blossom of the quadratic at (t0, t1).
  return (1 - t0) * (1 - t1) * a + ((1 - t0) * t1 + t0 * (1 - t1)) * c + t0 * t1 * b;
}

/** Bezier parameter at arc length s along a flattened curve. */
export function paramAtArc(poly: Polyline, s: number): number {
  if (s <= 0) return 0;
  if (s >= poly.length) return 1;
  let lo = 0;
  let hi = poly.n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (poly.s[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const span = poly.s[hi]! - poly.s[lo]!;
  const k = span > 0 ? (s - poly.s[lo]!) / span : 0;
  return poly.t[lo]! + (poly.t[hi]! - poly.t[lo]!) * k;
}
