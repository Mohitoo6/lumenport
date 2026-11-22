import { describe, expect, it } from 'vitest';
import { decodeState, encodeState } from '../../src/platform/portable';
import { validateState } from '../../src/sim/save/serialize';
import { grownTown } from '../game/town';

describe('portable saves (for the cloud)', () => {
  it('round-trips a grown city exactly, and is small', async () => {
    const sim = grownTown(150);
    const blob = await encodeState(sim.state);
    console.log(`grown town: ${(blob.length / 1024).toFixed(0)} KB as base64 gzip`);
    expect(blob.length).toBeLessThan(2_000_000);
    const back = validateState(await decodeState(blob));
    expect(typeof back).not.toBe('string');
    const s = back as typeof sim.state;
    expect(s.heights).toBeInstanceOf(Float32Array);
    expect(Array.from(s.heights)).toEqual(Array.from(sim.state.heights));
    expect(Array.from(s.zone)).toEqual(Array.from(sim.state.zone));
    expect(Array.from(s.buildingCell)).toEqual(Array.from(sim.state.buildingCell));
    expect(JSON.stringify(s.buildings)).toBe(JSON.stringify(sim.state.buildings));
    expect(s.funds).toBe(sim.state.funds);
    expect(s.tick).toBe(sim.state.tick);
  });

  it('refuses a damaged blob', async () => {
    await expect(decodeState('not a save')).rejects.toThrow();
  });
});
