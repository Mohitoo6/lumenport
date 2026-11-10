import { CELL } from '../../core/constants';
import { Rng } from '../../core/rng';
import { Facing, ZoneType, stageOf, zoneDensity, zoneType, type Building } from '../../sim/zoning/zones';
import { commercial } from './commercial';
import type { Lot } from './common';
import { construction } from './construction';
import { Geo } from './geo';
import { industrial } from './industrial';
import { residential } from './residential';

function design(l: Lot, type: ZoneType): void {
  if (type === ZoneType.Residential) residential(l);
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
  return { g, r: new Rng(b.seed ^ (b.level * 0x9e3779b1)), W, D, level: b.level, density: zoneDensity(b.zone) };
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
    design(lotFor(b, g), type);
    return g;
  }
  // A site needs to know what it is growing into: design the finished building once just
  // to measure it.
  const probe = new Geo();
  design(lotFor(b, probe), type);
  const l = lotFor(b, g);
  construction(l, stage, probe);
  return g;
}
