import { it } from 'vitest';
import { loadEnv } from 'vite';
import { complete, readProviders } from '../../server/llmProxy';
import { attendees, briefing } from '../../src/game/council/briefs';
import { detectIssues } from '../../src/game/council/issues';
import type { Transport } from '../../src/game/council/llm';
import { MINISTERS, MINISTER_BY_ID, type MinistryId } from '../../src/game/council/ministries';
import { optionsFor } from '../../src/game/council/options';
import { CouncilSession } from '../../src/game/council/session';
import { grownTown, runTicks } from './town';

// Manual check against the real AI providers in .env. Spends free-tier requests, so it
// only runs when REAL_COUNCIL=1.
it.runIf(process.env.REAL_COUNCIL === '1')('real council', async () => {
  const providers = readProviders(loadEnv('development', process.cwd(), ''));
  const transport: Transport = {
    label: 'real',
    complete: async (req) => {
      const r = await complete(providers, { system: req.system, user: req.user, maxTokens: req.maxTokens, json: true });
      if ('error' in r) throw new Error(r.error);
      return r;
    },
  };
  const sim = grownTown(150);
  sim.traffic.hour = 18;
  runTicks(sim, 1500);
  const issue = detectIssues(sim).find((i) => i.kind === (process.env.KIND ?? 'traffic'))!;
  const options = optionsFor(sim, issue);
  const seats = attendees(sim, issue, options);
  console.log('ISSUE', issue.title, '|', seats.map((s) => `${s.id} (${s.reason})`).join('; '));
  for (const o of options) console.log(`  ${o.id}. ${o.title} $${o.cost}`);
  const briefings = Object.fromEntries(MINISTERS.map((m) => [m.id, briefing(sim, m.id)])) as Record<MinistryId, string[]>;
  const t0 = Date.now();
  const lang = process.env.COUNCIL_LANG === 'hi' ? 'hi' : 'en';
  await new CouncilSession({ city: 'New Haven', issue, options, seats, briefings, mayorNote: process.env.NOTE ?? '', lang }, transport, (e) => {
    const t = ((Date.now() - t0) / 1000).toFixed(1);
    if (e.type === 'said') console.log(`[${t}s] R${e.statement.round} ${MINISTER_BY_ID[e.statement.minister].short} (${e.statement.stance}, backs ${e.statement.option}) via ${e.provider}: ${e.statement.text}${e.statement.condition ? ' | condition: ' + e.statement.condition : ''}`);
    else if (e.type === 'silent') console.log(`[${t}s] R${e.round} ${e.who}: (no comment)`);
    else if (e.type === 'failed') console.log(`[${t}s] FAILED ${e.who}: ${e.error}`);
    else if (e.type === 'decision') console.log(`[${t}s] DECISION ${e.decision.option} via ${e.provider}: ${e.decision.summary} | dissent: ${e.decision.dissent} | conditions: ${e.decision.conditions} | tally ${JSON.stringify(e.decision.tally)}`);
    else if (e.type === 'error') console.log('ERROR', e.message);
  }).run();
}, 600_000);
