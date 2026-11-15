import { it } from 'vitest';
import { loadEnv } from 'vite';
import { complete, readProviders } from '../../server/llmProxy';
import { detectIssues } from '../../src/game/council/issues';
import { LlmError, type Transport } from '../../src/game/council/llm';
import { MINISTER_BY_ID } from '../../src/game/council/ministries';
import { CouncilSession, prepareMeeting } from '../../src/game/council/session';
import { Recorder } from '../../src/game/council/telemetry';
import { grownTown, runTicks } from './town';

// Manual check against the real AI providers in .env. Spends free-tier requests (one
// meeting: 5 to 8 calls), so it only runs when REAL_COUNCIL=1. Prints the transcript and
// the telemetry the inspector panel shows: calls, tokens as billed, latency, schema results.
it.runIf(process.env.REAL_COUNCIL === '1')(
  'real council',
  async () => {
    const providers = readProviders(loadEnv('development', process.cwd(), ''));
    const transport: Transport = {
      label: 'AI',
      complete: async (req) => {
        const r = await complete(providers, { system: req.system, user: req.user, maxTokens: req.maxTokens, json: true, schema: req.schema, schemaName: req.schemaName });
        if ('error' in r) throw new LlmError(r.error, r.rateLimited ? 429 : 502, r.rateLimited);
        return r;
      },
    };
    const sim = grownTown(150);
    sim.traffic.hour = 18;
    runTicks(sim, 1500);
    const issue = detectIssues(sim).find((i) => i.kind === (process.env.KIND ?? 'traffic'))!;
    const meeting = prepareMeeting(sim, issue);
    console.log('ISSUE', issue.title, '|', meeting.seats.map((s) => s.id + ' (' + s.reason + ')').join('; '));
    for (const o of meeting.options) console.log('  ' + o.id + '. ' + o.title + ' $' + o.cost + ' ' + o.feasibility.status);
    const recorder = new Recorder({
      mode: 'live',
      issue: { key: issue.key, kind: issue.kind, title: issue.title, severity: issue.severity, lead: issue.lead },
      day: 0,
      trigger: 'manual',
      triage: meeting.triage,
      limits: meeting.limits,
      options: [],
      memory: [],
    });
    const t0 = Date.now();
    const lang = process.env.COUNCIL_LANG === 'hi' ? 'hi' : 'en';
    const stamp = (): string => '[' + ((Date.now() - t0) / 1000).toFixed(1) + 's]';
    await new CouncilSession(
      { city: 'New Haven', issue, options: meeting.options, seats: meeting.seats, briefings: meeting.briefings, limits: meeting.limits, mayorNote: process.env.NOTE ?? '', lang },
      transport,
      (e) => {
        if (e.type === 'said') {
          const s = e.statement;
          console.log(stamp(), 'R' + s.round, MINISTER_BY_ID[s.minister].short, '(' + s.stance + ', backs ' + s.option + ')', s.standIn ? '[stand-in]' : '', 'via', e.provider + ':', s.text, s.condition ? '| condition: ' + s.condition : '', s.flags ? '| FLAGS: ' + s.flags.join(' ') : '');
        } else if (e.type === 'silent') console.log(stamp(), 'R' + e.round, e.who + ': (no comment)');
        else if (e.type === 'failed') console.log(stamp(), 'FAILED', e.who + ':', e.error);
        else if (e.type === 'notice') console.log(stamp(), 'NOTICE', e.message);
        else if (e.type === 'decision') {
          const d = e.decision;
          const flagged = d.guardrail.findings.filter((f) => !f.passed).map((f) => f.detail);
          console.log(stamp(), 'DECISION', d.option, 'via', e.provider + ':', d.summary, '| dissent:', d.dissent, '| conditions:', d.conditions, '| tally', JSON.stringify(d.tally), '| guardrails', d.guardrail.status + ':', flagged.join(' ') || 'all passed');
        } else if (e.type === 'error') console.log('ERROR', e.message);
      },
      { recorder },
    ).run();
    const trace = recorder.trace;
    console.log('GRAPH', trace.transitions.map((x) => x.from + '->' + x.to + ' (' + x.reason + ')').join(' | '));
    for (const s of trace.spans) {
      console.log('SPAN', s.agent, 'r' + s.round, s.source, s.provider, s.latencyMs + 'ms', 'in=' + s.usage.prompt, 'out=' + s.usage.completion, 'think=' + s.usage.reasoning, '(' + s.usage.source + ')', 'schema=' + s.schema, s.repairs.length ? 'repairs: ' + s.repairs.join(', ') : '', s.fallbackReason ? 'fallback: ' + s.fallbackReason : '', s.truncated ? 'TRUNCATED' : '');
    }
    console.log('TOTALS', JSON.stringify(trace.totals));
  },
  600_000,
);
