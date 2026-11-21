import { expect, test, type Page } from '@playwright/test';
import { buildTown, openGame, zoneTown, advance } from './helpers';

type Pose = { x: number; z: number; dist: number; yaw: number };
const pose = (page: Page): Promise<Pose> =>
  page.evaluate(async () => {
    await window.__game!.frames(20);
    const p = (window.__game!.game as unknown as { rig: { pose: Pose } }).rig.pose;
    return { x: p.x, z: p.z, dist: p.dist, yaw: p.yaw };
  });
const moved = (a: Pose, b: Pose): number => Math.hypot(a.x - b.x, a.z - b.z);

/** Moving around with the mouse, a trackpad and a touch screen, without the keyboard. */
test('drag, swipe, wheel and pinch move the camera', async ({ page }) => {
  test.setTimeout(300_000);
  await openGame(page, 'shots=1');
  await buildTown(page);
  await zoneTown(page);
  await advance(page, 1500);
  await page.evaluate(() => window.__game!.camera({ x: 1340, z: 620, yaw: 0.3, pitch: 0.8, dist: 420 }, true));
  const start = await pose(page);

  // Left-drag on the map with no tool: the map moves, and nothing gets inspected.
  await page.mouse.move(800, 450);
  await page.mouse.down();
  await page.mouse.move(700, 400, { steps: 8 });
  await page.mouse.move(600, 350, { steps: 8 });
  await page.mouse.up();
  const afterDrag = await pose(page);
  console.log('drag moved', moved(start, afterDrag).toFixed(1), 'm');
  expect(moved(start, afterDrag)).toBeGreaterThan(40);
  expect(Math.abs(afterDrag.dist - start.dist)).toBeLessThan(1);
  expect(await page.locator('.inspect').count()).toBe(0);

  // A click without moving still inspects.
  await page.mouse.click(800, 450);
  await page.evaluate(() => window.__game!.frames(6));

  // A mouse wheel notch zooms.
  await page.mouse.move(800, 450);
  await page.mouse.wheel(0, 120);
  const afterWheel = await pose(page);
  console.log('wheel dist', start.dist.toFixed(0), '->', afterWheel.dist.toFixed(0));
  expect(afterWheel.dist).toBeGreaterThan(afterDrag.dist * 1.05);

  // A trackpad swipe (sideways and small steps) moves the map instead.
  const beforeSwipe = await pose(page);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(14, 9);
  const afterSwipe = await pose(page);
  console.log('swipe moved', moved(beforeSwipe, afterSwipe).toFixed(1), 'm, dist', beforeSwipe.dist.toFixed(0), '->', afterSwipe.dist.toFixed(0));
  expect(moved(beforeSwipe, afterSwipe)).toBeGreaterThan(20);
  expect(Math.abs(afterSwipe.dist - beforeSwipe.dist)).toBeLessThan(2);

  // The zone tool keeps its drag for painting: the map does not move.
  await page.evaluate(() => window.__game!.frames(30));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Homes' }).click();
  const beforeZone = await pose(page);
  await page.mouse.move(800, 500);
  await page.mouse.down();
  await page.mouse.move(700, 450, { steps: 6 });
  await page.mouse.up();
  const afterZone = await pose(page);
  expect(moved(beforeZone, afterZone)).toBeLessThan(1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Touch: one finger pans; two fingers spreading apart zoom in.
  const cdp = await page.context().newCDPSession(page);
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', pts: Array<[number, number]>): Promise<void> => {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  };
  const beforeTouch = await pose(page);
  await touch('touchStart', [[800, 450]]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[800 - i * 12, 450 - i * 6]]);
  await touch('touchEnd', []);
  const afterTouch = await pose(page);
  console.log('one finger moved', moved(beforeTouch, afterTouch).toFixed(1), 'm');
  expect(moved(beforeTouch, afterTouch)).toBeGreaterThan(20);
  await touch('touchStart', [[760, 450], [840, 450]]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[760 - i * 12, 450], [840 + i * 12, 450]]);
  await touch('touchEnd', []);
  const afterPinch = await pose(page);
  console.log('pinch dist', afterTouch.dist.toFixed(0), '->', afterPinch.dist.toFixed(0));
  expect(afterPinch.dist).toBeLessThan(afterTouch.dist * 0.8);
});
