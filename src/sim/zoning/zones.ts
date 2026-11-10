export const enum ZoneType {
  None = 0,
  Residential = 1,
  Commercial = 2,
  Industrial = 3,
}

/** 1 = low, 2 = medium, 3 = high. */
export type Density = 1 | 2 | 3;

/** A zone is stored in one byte: type in the upper bits, density in the lower two. */
export function zoneCode(type: ZoneType, density: Density): number {
  return type === ZoneType.None ? 0 : (type << 2) | density;
}

export function zoneType(code: number): ZoneType {
  return (code >> 2) as ZoneType;
}

export function zoneDensity(code: number): Density {
  return (code & 3) as Density;
}

export const ZONE_NAMES: Record<ZoneType, string> = {
  [ZoneType.None]: 'Unzoned',
  [ZoneType.Residential]: 'Residential',
  [ZoneType.Commercial]: 'Commercial',
  [ZoneType.Industrial]: 'Industrial',
};

export const DENSITY_NAMES = ['', 'Low', 'Medium', 'High'] as const;

/** Facing: which side of a lot its road is on. */
export const enum Facing {
  North = 0,
  East = 1,
  South = 2,
  West = 3,
}

/** Cell step toward the road for each facing. */
export const FACING_DX = [0, 1, 0, -1] as const;
export const FACING_DY = [-1, 0, 1, 0] as const;

/** A building that grew on zoned land. */
export interface Building {
  id: number;
  /** Zone code it was built under. */
  zone: number;
  /** Lot rectangle in cells: origin (min corner) and size. */
  x: number;
  y: number;
  w: number;
  h: number;
  facing: Facing;
  /** 1..3. Higher levels are bigger and better appointed. */
  level: number;
  /** Construction progress, 0..1. 1 means finished. */
  progress: number;
  /** Stable random seed that drives its appearance. */
  seed: number;
  /** Height of the building pad, metres. */
  baseY: number;
}

/** Visible construction stage: 0 site, 1-3 frame rising, 4 finished. */
export function stageOf(progress: number): number {
  if (progress >= 1) return 4;
  if (progress < 0.2) return 0;
  if (progress < 0.45) return 1;
  if (progress < 0.7) return 2;
  return 3;
}

/** Days to build, indexed by zone code. */
export function buildDays(zone: number): number {
  const t = zoneType(zone);
  const d = zoneDensity(zone);
  if (t === ZoneType.Residential) return [0, 5, 8, 14][d]!;
  if (t === ZoneType.Commercial) return [0, 6, 10, 16][d]!;
  return [0, 6, 9, 12][d]!;
}
