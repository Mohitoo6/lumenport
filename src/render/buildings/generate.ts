import { CELL } from '../../core/constants';
import { Rng } from '../../core/rng';
import { Facing, ZoneType, stageOf, zoneDensity, zoneType, type Building } from '../../sim/zoning/zones';
import { commercial } from './commercial';
import type { Lot } from './common';
import { construction } from './construction';
import { facility } from './facilities';
import { Geo } from './geo';
import { industrial } from './industrial';
import { residential } from './residential';

function design(l: Lot, type: ZoneType, kind: number): void {
  if (kind !== 0) facility(l, kind);
  else if (type === ZoneType.Residential) residential(l);
  else if (type === ZoneType.Commercial) commercial(l);
  else industrial(l);
}

function lotFor(b: Building, g: Geo): Lot {
  const alongX = b.facing === Facing.North || b.facing === Facing.South;
  const W = (alongX ? b.w : b.h) * CELL;
  const D = (alongX ? b.h : b.w) * CELL;
  g.frame((b.x + b.w / 2) * CELL, b.baseY, (b.y + b.h / 2) * CELL, b.facing);
  // Lit-window pattern and other shader randomness key off this.
  g.seed = ((b.seed >>> 4) % 4096) / 4096;
  return { g, r: new Rng(b.seed ^ (b.level * 0x9e3779b1)), W, D, level: b.level, density: b.kind !== 0 ? 1 : zoneDensity(b.zone) };
}

/**
 * Builds the mesh for one building in its current state. The same seed always gives the
 * same building, so a saved city looks identical when it is loaded again.
 */
export function generateBuilding(b: Building): Geo {
  const type = zoneType(b.zone);
  const stage = stageOf(b.progress);
  const g = new Geo();
  if (stage >= 4) {
    design(lotFor(b, g), type, b.kind);
    return g;
  }
  // A site needs to know what it is growing into: design the finished building once just
  // to measure it.
  const probe = new Geo();
  design(lotFor(b, probe), type, b.kind);
  const l = lotFor(b, g);
  // Keep the site frame inside the lot, and modest for facilities (their masts and
  // chimneys are not something a concrete frame grows into).
  construction(l, stage, {
    minX: Math.max(probe.minX, -l.W / 2 + 1),
    maxX: Math.min(probe.maxX, l.W / 2 - 1),
    minZ: Math.max(probe.minZ, -l.D / 2 + 1),
    maxZ: Math.min(probe.maxZ, l.D / 2 - 1),
    maxY: b.kind !== 0 ? Math.min(probe.maxY, 10) : probe.maxY,
  });
  return g;
}
