import { beforeAll, describe, expect, it } from 'vitest';
import { detectIssues } from '../../src/game/council/issues';
import type { LlmRequest, Transport } from '../../src/game/council/llm';
import { BUDGET, CouncilSession, prepareMeeting } from '../../src/game/council/session';
import { estimateTokens } from '../../src/game/council/telemetry';
import type { Sim } from '../../src/sim/sim';
import { grownTown, runTicks } from './town';

/**
 * The token budget of a council meeting, as a regression test. No model is called: the
 * prompts are built for real and their size is counted (about 4 characters per token).
 *
 * BEFORE holds the same measurement taken on the previous design (commit 031e905) with the
 * same town, the same issues and the same counting, with every seat speaking in both
 * rounds, which is what the recorded real-AI runs in eval/runs showed (0 silent turns in
 * 12 meetings; statements averaged about 340 characters).
 */
const BEFORE: Record<string, { seats: number; calls: number; input: number; output: number }> = {
  traffic: { seats: 5, calls: 11, input: 17049, output: 1269 },
  health: { seats: 3, calls: 7, input: 8035, output: 813 },
  jobs: { seats: 3, calls: 7, input: 8712, output: 813 },
};

/** Two sentences of about 45 words: what the new contract asks a minister for. */
const SAY = 'x'.repeat(250);

interface Cost {
  calls: number;
  input: number;
  output: number;
  perCall: Array<{ who: string; round: number; tokens: number }>;
}

async function measure(sim: Sim, kind: string, contested: boolean): Promise<Cost & { seats: number }> {
  const issue = detectIssues(sim).find((i) => i.kind === kind)!;
  const m = prepareMeeting(sim, issue);
  const cost: Cost = { calls: 0, input: 0, output: 0, perCall: [] };
  const transport: Transport = {
    label: 'AI',
    complete: async (req: LlmRequest) => {
      const chief = req.meta.role === 'chief';
      // Contested: every other minister objects and backs B, so round 2 is as full as it can be.
      const reply = chief
        ? JSON.stringify({ option: 'A', summary: 'y'.repeat(300), dissent: 'z'.repeat(80), conditions: 'w'.repeat(80) })
        : JSON.stringify({ speak: true, stance: req.meta.lead ? 'propose' : contested ? 'oppose' : 'support', option: req.meta.lead || !contested ? 'A' : 'B', say: SAY, condition: 'c'.repeat(40) });
      const tokens = estimateTokens(req.system) + estimateTokens(req.user);
      cost.calls++;
      cost.input += tokens;
      cost.output += estimateTokens(reply);
      cost.perCall.push({ who: req.meta.minister ?? 'chief', round: req.meta.round ?? 3, tokens });
      return { provider: 'measure', text: reply };
    },
  };
  await new CouncilSession({ city: 'New Haven', issue, options: m.options, seats: m.seats, briefings: m.briefings, limits: m.limits, mayorNote: '', lang: 'en' }, transport, () => {}).run();
  return { ...cost, seats: m.seats.length };
}

describe('token budget per council meeting', () => {
  let sim: Sim;
  beforeAll(() => {
    sim = grownTown(150);
    sim.traffic.hour = 18;
    runTicks(sim, 1500);
  });

  it('costs a fraction of the previous design, in calls and in tokens', async () => {
    const rows: string[] = [];
    for (const kind of Object.keys(BEFORE)) {
      const before = BEFORE[kind]!;
      const agreed = await measure(sim, kind, false);
      const contested = await measure(sim, kind, true);
      const cut = (now: number, was: number): string => `-${Math.round((1 - now / was) * 100)}%`;
      rows.push(
        `${kind.padEnd(8)} before: ${before.calls} calls, ${before.input} in, ${before.output} out | agreed: ${agreed.calls} calls, ${agreed.input} in (${cut(agreed.input, before.input)}), ${agreed.output} out | contested: ${contested.calls} calls, ${contested.input} in (${cut(contested.input, before.input)}), ${contested.output} out (${cut(contested.output, before.output)})`,
      );
      // The worst case of the new design must beat the typical case of the old one by half.
      expect(contested.calls).toBeLessThanOrEqual(BUDGET.maxCalls);
      // A fully contested three-seat meeting needs as many calls as before (3 + 3 + 1); nothing needs more.
      expect(contested.calls).toBeLessThanOrEqual(before.calls);
      expect(contested.input).toBeLessThan(before.input * 0.7);
      expect(contested.output).toBeLessThan(before.output);
      // An uncontested meeting is one call per seat plus the chair.
      expect(agreed.calls).toBe(agreed.seats + 1);
      expect(agreed.input).toBeLessThan(before.input * 0.4);
    }
    console.log(`\nTokens per council meeting (estimated at 4 characters per token)\n${rows.join('\n')}\n`);
  });

  it('keeps every single prompt small', async () => {
    const contested = await measure(sim, 'traffic', true);
    for (const c of contested.perCall) expect(c.tokens, `${c.who} round ${c.round}`).toBeLessThan(1200);
    console.log(contested.perCall.map((c) => `${c.who} r${c.round}: ${c.tokens}`).join(', '));
  });
});
