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

/**
 * What zoning one cell costs, by type and density: the city lays the water, drains and
 * power lines the new buildings hook up to. Clearing a zone is free.
 */
export const ZONE_CELL_COST: Record<number, readonly [number, number, number, number]> = {
  [ZoneType.Residential]: [0, 4, 7, 11],
  [ZoneType.Commercial]: [0, 5, 9, 14],
  [ZoneType.Industrial]: [0, 6, 10, 15],
};

export function zoneCellCost(code: number): number {
  return code === 0 ? 0 : (ZONE_CELL_COST[zoneType(code)]?.[zoneDensity(code)] ?? 0);
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

/** A building: one that grew on zoned land, or a facility the player placed. */
export interface Building {
  id: number;
  /** 0 for zoned buildings, otherwise a FacilityKind. */
  kind: number;
  /** Zone code it was built under (0 for facilities). */
  zone: number;
  /** Lot rectangle in cells: origin (min corner) and size. */
  x: number;
  y: number;
  w: number;
  h: number;
  facing: Facing;
  /**
   * When the road is not on the grid: the angle the building is drawn facing (facing
   * vector (sin a, cos a)). The lot itself stays on the grid.
   */
  dir?: number;
  /** 1..3. Higher levels are bigger and better appointed. */
  level: number;
  /** Construction progress, 0..1. 1 means finished. */
  progress: number;
  /** Stable random seed that drives its appearance. */
  seed: number;
  /** Height of the building pad, metres. */
  baseY: number;
  /** Residents living here, or workers employed here. */
  pop: number;
  /** Status bits, see utilities/network.ts. */
  flags: number;
}

/** Visible construction stage: 0 site, 1-3 frame rising, 4 finished. */
export function stageOf(progress: number): number {
  if (progress >= 1) return 4;
  if (progress < 0.2) return 0;
  if (progress < 0.45) return 1;
  if (progress < 0.7) return 2;
  return 3;
}

/** Economy steps (2 real seconds each) a building takes to go up, by zone type and density. */
export function buildSteps(zone: number): number {
  const t = zoneType(zone);
  const d = zoneDensity(zone);
  if (t === ZoneType.Residential) return [0, 5, 8, 14][d]!;
  if (t === ZoneType.Commercial) return [0, 6, 10, 16][d]!;
  return [0, 6, 9, 12][d]!;
}
