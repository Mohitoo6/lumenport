import { ZoneType, zoneDensity, zoneType, type Building } from '../zoning/zones';

/** Residents (homes) or jobs (shops, industry) per lot cell, by density. */
const PER_CELL: Record<number, readonly number[]> = {
  [ZoneType.Residential]: [0, 1.1, 4.5, 15],
  [ZoneType.Commercial]: [0, 1.4, 4.5, 17],
  [ZoneType.Industrial]: [0, 1.3, 2.6, 4.2],
};

/** How many residents or workers a zoned building holds when full. Facilities hold none. */
export function capacityOf(b: Building): number {
  if (b.kind !== 0) return 0;
  const per = PER_CELL[zoneType(b.zone)]![zoneDensity(b.zone)]!;
  return Math.max(1, Math.round(per * b.w * b.h * (0.7 + 0.3 * b.level)));
}
