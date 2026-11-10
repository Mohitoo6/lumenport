/** Integer hash (lowbias32). Deterministic across platforms. */
export function hash32(a: number): number {
  a |= 0;
  a ^= a >>> 16;
  a = Math.imul(a, 0x7feb352d);
  a ^= a >>> 15;
  a = Math.imul(a, 0x846ca68b);
  a ^= a >>> 16;
  return a >>> 0;
}

/** Hash of two integers and a seed, as a float in [0, 1). */
export function hash2(x: number, y: number, seed: number): number {
  return hash32((x | 0) + Math.imul(hash32((y | 0) + Math.imul(seed | 0, 0x27d4eb2d)), 0x165667b1)) / 4294967296;
}

/** Advances a mulberry32 state. Returns the next state; pair with `rngFloat`. */
export function rngNext(state: number): number {
  return (state + 0x6d2b79f5) | 0;
}

export function rngFloat(state: number): number {
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Small stateful PRNG. The state is a single int32, so it serialises with the game. */
export class Rng {
  constructor(public state: number) {}

  next(): number {
    this.state = rngNext(this.state);
    return rngFloat(this.state);
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }
}
