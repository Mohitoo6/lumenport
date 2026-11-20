import type { RoadRequest } from './roads/plan';
import type { Speed } from './state';

/** Every mutation of the game goes through a command. Commands are plain serialisable data. */
export type Command =
  | { type: 'setSpeed'; speed: Speed }
  | { type: 'renameCity'; name: string }
  | ({ type: 'buildRoad' } & RoadRequest)
  | { type: 'bulldozeRoad'; edge: number }
  /** Rebuilds an existing road segment as another type (for example, street to avenue). */
  | { type: 'upgradeRoad'; edge: number; road: number }
  /** Paints a zone code (0 clears) over a rectangle of cells, inclusive. */
  | { type: 'zoneRect'; x0: number; y0: number; x1: number; y1: number; zone: number }
  /** A metro line between two stations, bent through `via` points ([x, z] in metres). */
  | { type: 'buildMetro'; a: number; b: number; via: Array<[number, number]> }
  | { type: 'removeMetro'; line: number }
  /** Zones both sides of these road edges, as deep as lots can reach (or clears them with zone 0). */
  | { type: 'zoneAlong'; edges: number[]; zone: number }
  | { type: 'bulldozeBuilding'; id: number }
  /** Places a facility with its centre on cell (x, y). */
  | { type: 'placeFacility'; kind: number; x: number; y: number }
  /** zone: 1 residential, 2 commercial, 3 industrial. rate in percent, 0..20. */
  | { type: 'setTax'; zone: number; rate: number }
  | { type: 'takeLoan'; tier: number }
  | { type: 'setSandbox'; on: boolean }
  | { type: 'setPolicy'; policy: 'flexHours'; on: boolean }
  /** Places the town hall, already built, on the best site near the city centre. */
  | { type: 'foundTownHall' };

export interface CommandResult {
  ok: boolean;
  /** Human-readable reason when ok is false. */
  reason?: string;
  /** Money spent, when the command cost something. */
  cost?: number;
  /** How many cells or items the command affected, when that is useful to report. */
  count?: number;
}

export const OK: CommandResult = { ok: true };

export function fail(reason: string): CommandResult {
  return { ok: false, reason };
}
