import { beforeAll, describe, expect, it } from 'vitest';
import { CouncilController, speechSeconds } from '../../src/game/council/controller';
import type { Sim } from '../../src/sim/sim';
import type { Speed } from '../../src/sim/state';
import { ui } from '../../src/ui/store';
import { grownTown } from './town';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let sim: Sim;
beforeAll(() => {
  sim = grownTown(150);
});

function controller(): CouncilController {
  let speed: Speed = 1;
  const c = new CouncilController({
    sim,
    cityName: () => 'Testville',
    lookAt: () => {},
    speed: () => speed,
    setSpeed: (s) => (speed = s),
    chime: () => {},
  });
  c.auto = false;
  c.forceDemo = true;
  return c;
}

function open(c: CouncilController): void {
  c.update(2.01);
  const issue = c.issues[0];
  expect(issue, 'the test town has a problem to discuss').toBeDefined();
  c.convene(issue!.key);
  expect(ui.council.value?.phase).toBe('brief');
  c.start('', 'en', true);
}

describe('council playback', () => {
  it('lets one minister speak at a time, for as long as the words take, and the chair last', async () => {
    const c = controller();
    open(c);
    const order: string[] = [];
    let speakingAtDecision: unknown = 'unset';
    for (let i = 0; i < 2000 && ui.council.value?.phase === 'debate'; i++) {
      await sleep(5);
      c.update(0.25);
      const v = ui.council.value!;
      const sp = v.speaking;
      if (sp && order[order.length - 1] !== sp.key) {
        order.push(sp.key);
        // Only the person on the floor is marked as speaking.
        const speakers = v.seats.filter((s) => s.state === 'speaking').length + (v.chief === 'speaking' ? 1 : 0);
        expect(speakers).toBe(1);
        expect(sp.seconds).toBe(speechSeconds(v.messages[v.messages.length - 1]!.text));
      }
      if (v.phase !== 'debate') speakingAtDecision = v.speaking;
    }
    const v = ui.council.value!;
    expect(v.phase).toBe('decided');
    // Every statement was delivered once, in the order it was shown, ending with the chair.
    expect(order).toEqual(v.messages.map((m) => m.key));
    expect(order[order.length - 1]).toBe('chief');
    expect(order.length).toBeGreaterThan(2);
    // The verdict appears only once the Chief Secretary has finished speaking.
    expect(speakingAtDecision).toBeUndefined();
    expect(v.seats.every((s) => s.state === 'spoke' || s.state === 'silent')).toBe(true);
    c.close();
    expect(ui.council.value).toBeNull();
  });

  it('skips ahead to everything already said', async () => {
    const c = controller();
    open(c);
    // Let the demo ministers finish without advancing playback, then fast-forward.
    for (let i = 0; i < 1000 && c.consulting; i++) {
      await sleep(10);
      c.update(0);
    }
    expect(c.consulting).toBe(false);
    expect(ui.council.value?.phase).toBe('debate');
    c.skip();
    const v = ui.council.value!;
    expect(v.phase).toBe('decided');
    expect(v.speaking).toBeUndefined();
    expect(v.messages[v.messages.length - 1]!.who).toBe('chief');
    c.close();
  });

  it('paces speeches by length, within limits', () => {
    expect(speechSeconds('Short.')).toBe(4);
    expect(speechSeconds('x'.repeat(150))).toBe(10);
    expect(speechSeconds('x'.repeat(2000))).toBe(16);
  });
});
