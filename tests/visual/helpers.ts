import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

export interface Pose {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  dist: number;
}

const deg = (d: number): number => (d * Math.PI) / 180;

export function pose(x: number, z: number, yawDeg: number, pitchDeg: number, dist: number): Pose {
  return { x, z, yaw: deg(yawDeg), pitch: deg(pitchDeg), dist };
}

/** Opens the game and waits until the first frames have rendered. */
export async function openGame(page: Page, query = 'shots=1'): Promise<void> {
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') console.log(`[browser ${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => console.log(`[browser exception] ${err.message}`));
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 120_000 });
  await page.evaluate(() => window.__game!.frames(4));
}

/** Moves the camera, lets shaders and LOD settle, and saves a screenshot. */
export async function shoot(page: Page, phase: number, name: string, p: Pose, frames = 12): Promise<void> {
  await page.evaluate(
    async ({ p, frames }) => {
      window.__game!.camera(p, true);
      await window.__game!.frames(frames);
    },
    { p, frames },
  );
  const dir = join('screenshots', `phase-${phase}`);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

type Road = [ax: number, az: number, bx: number, bz: number, road?: number, cx?: number, cz?: number];

/** A small town plan that exercises every junction shape the road mesher has to handle. */
const TOWN_ROADS: Road[] = [
  // Avenue spine with a street grid on both sides.
  [1040, 584, 1600, 584, 1],
  [1120, 424, 1120, 744],
  [1248, 424, 1248, 744],
  [1376, 424, 1376, 744],
  [1504, 424, 1504, 744],
  [1040, 488, 1600, 488],
  [1040, 680, 1600, 680],
  [1040, 424, 1600, 424],
  // Diagonal streets: skewed junctions.
  [1120, 744, 1280, 904],
  [1248, 744, 1376, 872],
  // Curved streets.
  [1600, 424, 1760, 584, 0, 1760, 424],
  [1600, 680, 1760, 584, 0, 1760, 680],
  [1600, 584, 1760, 584, 1],
  // Dead-end spur and a long road south over the river.
  [1504, 744, 1504, 816],
  [1376, 744, 1376, 1504],
];

export async function buildTown(page: Page): Promise<void> {
  const results = await page.evaluate((roads) => {
    return roads.map(([ax, az, bx, bz, road, cx, cz]) => {
      const r = window.__game!.exec({ type: 'buildRoad', road: road ?? 0, ax, az, bx, bz, cx, cz });
      return r.ok ? 'ok' : `FAILED ${ax},${az} -> ${bx},${bz}: ${r.reason}`;
    });
  }, TOWN_ROADS);
  for (const r of results) if (r !== 'ok') console.log(r);
}

/** Zone codes: type * 4 + density, with R = 1, C = 2, I = 3. */
const Z = { R1: 5, R2: 6, R3: 7, C1: 9, C2: 10, C3: 11, I1: 13, I2: 14, I3: 15 };

type ZoneRect = [x0: number, y0: number, x1: number, y1: number, zone: number];

/** Every zone and density somewhere in the test town (cell rectangles). */
const TOWN_ZONES: ZoneRect[] = [
  [131, 47, 199, 51, Z.R1],
  [131, 54, 170, 59, Z.R1],
  [173, 54, 199, 59, Z.R2],
  [131, 62, 138, 70, Z.R3],
  [141, 62, 154, 70, Z.R2],
  [157, 62, 170, 70, Z.C1],
  [173, 62, 186, 70, Z.C2],
  [189, 62, 199, 70, Z.C1],
  [131, 75, 138, 83, Z.C3],
  [141, 75, 154, 83, Z.R3],
  [157, 75, 170, 83, Z.C3],
  [173, 75, 186, 83, Z.C2],
  [189, 75, 199, 83, Z.C3],
  [131, 86, 138, 92, Z.I1],
  [141, 86, 154, 92, Z.I1],
  [157, 86, 170, 92, Z.I2],
  [173, 86, 186, 92, Z.I3],
  [189, 86, 199, 92, Z.I2],
];

export async function zoneTown(page: Page): Promise<void> {
  await page.evaluate((zones) => {
    for (const [x0, y0, x1, y1, zone] of zones) window.__game!.exec({ type: 'zoneRect', x0, y0, x1, y1, zone });
    window.__game!.game.sim.growthRate = 1;
  }, TOWN_ZONES);
}

/** Runs the simulation forward and lets the renderer catch up with the changes. */
export async function advance(page: Page, ticks: number): Promise<void> {
  await page.evaluate(async (n) => {
    const step = 200;
    for (let done = 0; done < n; done += step) {
      window.__game!.advance(Math.min(step, n - done));
      await window.__game!.frames(2);
    }
    await window.__game!.frames(30);
  }, ticks);
}
