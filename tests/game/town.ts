import { TICKS_PER_DAY } from '../../src/core/constants';
import { RoadType } from '../../src/sim/roads/types';
import { Sim } from '../../src/sim/sim';

type Road = [ax: number, az: number, bx: number, bz: number, road?: number];

/** The scripted test town used by the screenshot runs: a street grid on an avenue spine. */
const ROADS: Road[] = [
  [1040, 584, 1600, 584, 1],
  [1120, 424, 1120, 744],
  [1248, 424, 1248, 744],
  [1376, 424, 1376, 744],
  [1504, 424, 1504, 744],
  [1040, 488, 1600, 488],
  [1040, 680, 1600, 680],
  [1040, 424, 1600, 424],
  [1376, 744, 1376, 1000],
  [1040, 840, 1600, 840],
];

const Z = { R1: 5, R2: 6, R3: 7, C1: 9, C2: 10, C3: 11, I1: 13, I2: 14 };

const ZONES: Array<[number, number, number, number, number]> = [
  [131, 47, 199, 51, Z.R1],
  [131, 54, 170, 59, Z.R2],
  [173, 54, 199, 59, Z.R2],
  [131, 62, 154, 70, Z.R3],
  [157, 62, 199, 70, Z.C2],
  [131, 75, 154, 83, Z.R3],
  [157, 75, 199, 83, Z.C3],
  [131, 86, 170, 92, Z.I1],
  [173, 86, 199, 92, Z.I2],
];

/** A grown city on real terrain. Real economy unless `sandbox`; utilities placed. */
export function grownTown(days: number, sandbox = false): Sim {
  const sim = Sim.create(1337);
  sim.state.sandbox = sandbox;
  sim.apply({ type: 'takeLoan', tier: 0 });
  sim.apply({ type: 'takeLoan', tier: 1 });
  for (const [ax, az, bx, bz, road] of ROADS) sim.apply({ type: 'buildRoad', road: road ?? RoadType.Street, ax, az, bx, bz });
  sim.apply({ type: 'placeFacility', kind: 1, x: 174, y: 100 });
  sim.apply({ type: 'placeFacility', kind: 4, x: 173, y: 96 });
  sim.apply({ type: 'placeFacility', kind: 4, x: 169, y: 96 });
  for (const [x0, y0, x1, y1, zone] of ZONES) sim.apply({ type: 'zoneRect', x0, y0, x1, y1, zone });
  if (sandbox) sim.growthRate = 1;
  for (let i = 0; i < days * TICKS_PER_DAY; i++) sim.tick();
  return sim;
}

export function runTicks(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.tick();
}
