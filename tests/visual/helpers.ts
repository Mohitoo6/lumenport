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
