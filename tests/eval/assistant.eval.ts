import { mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { type Provider } from '../../server/llmProxy';
import { evalProviders, patient } from './providers';
import type { AssistantReply } from '../../src/game/assistant/assistant';
import { AssistantController, type Completer } from '../../src/game/assistant/controller';
import { detectIssues } from '../../src/game/council/issues';
import { parseJsonReply } from '../../src/game/council/llm';
import { FacilityKind } from '../../src/sim/facilities';
import { RoadType } from '../../src/sim/roads/types';
import { Sim } from '../../src/sim/sim';
import { ZoneType, zoneCode } from '../../src/sim/zoning/zones';
import { grownTown, runTicks } from '../game/town';
import { checkNumbers, devanagariShare } from './grade';

/**
 * Evaluates the mayor's assistant against the real providers. Each case is a city whose
 * problem is known because the test built it that way; the answer must name that cause
 * (checked by keywords), quote only real figures, use the player's language and offer
 * buttons that exist. A judge model also rates correctness and usefulness.
 *   EVAL_ASSISTANT=1 npx vitest run --config vitest.eval.config.ts assistant
 */

const RUN = process.env.EVAL_ASSISTANT === '1';

interface Case {
  name: string;
  /** What the test built, i.e. the true answer. */
  truth: string;
  question: string;
  script: 'en' | 'hi' | 'latin';
  build(): { sim: Sim; refusal?: { cmd: Parameters<Sim['apply']>[0] } };
  /** Each inner list is "any of these words"; every group must appear. */
  mustMention: RegExp[];
  /** An action of one of these kinds should be offered. */
  expectAction?: Array<'council' | 'tool' | 'view' | 'budget'>;
}

function street(sim: Sim, z = 584): void {
  sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: 1040, az: z, bx: 1300, bz: z });
}

const CASES: Case[] = [
  {
    name: 'fresh city',
    truth: 'Nothing is built yet; the first step is a street.',
    question: 'I just started. What should I do first?',
    script: 'en',
    build: () => ({ sim: Sim.create(1337) }),
    mustMention: [/street|road/i],
    expectAction: ['tool'],
  },
  {
    name: 'no power or water',
    truth: 'Homes are zoned by a street but the city has no power plant and no water source.',
    question: 'Why are my homes not being built?',
    script: 'en',
    build: () => {
      const sim = Sim.create(1337);
      street(sim);
      sim.apply({ type: 'zoneRect', x0: 131, y0: 74, x1: 160, y1: 76, zone: zoneCode(ZoneType.Residential, 1) });
      runTicks(sim, 400);
      return { sim };
    },
    mustMention: [/power|electric/i, /water/i],
    expectAction: ['tool'],
  },
  {
    name: 'no power or water (Hinglish)',
    truth: 'Same city as above.',
    question: 'ghar kyu nahi ban rahe? kya karu?',
    script: 'latin',
    build: () => {
      const sim = Sim.create(1337);
      street(sim);
      sim.apply({ type: 'zoneRect', x0: 131, y0: 74, x1: 160, y1: 76, zone: zoneCode(ZoneType.Residential, 1) });
      runTicks(sim, 400);
      return { sim };
    },
    mustMention: [/power|bijli|electric/i, /water|paani|pani/i],
  },
  {
    name: 'zoned too far from the road',
    truth: 'Power and water are fine; the homes zone is 15+ cells from any road, so it can never build.',
    question: 'I zoned homes but nothing appears there. Why?',
    script: 'en',
    build: () => {
      const sim = Sim.create(1337);
      sim.state.sandbox = true;
      street(sim);
      sim.apply({ type: 'zoneRect', x0: 131, y0: 95, x1: 145, y1: 100, zone: zoneCode(ZoneType.Residential, 1) });
      runTicks(sim, 300);
      return { sim };
    },
    mustMention: [/road|street/i, /far|distance|4 cells|32 ?m|close|near|within/i],
  },
  {
    name: 'refused placement',
    truth: 'The player tried to place a clinic away from any road; facilities need a road in front.',
    question: "Why can't I place the clinic?",
    script: 'en',
    build: () => {
      const sim = Sim.create(1337);
      street(sim);
      return { sim, refusal: { cmd: { type: 'placeFacility', kind: FacilityKind.Clinic, x: 20, y: 20 } } };
    },
    mustMention: [/road|street/i],
  },
  {
    name: 'losing money',
    truth: 'A grown town with every tax set to 0%: income collapsed, so the monthly budget is in deficit.',
    question: 'Why is my money going down every month?',
    script: 'en',
    build: () => {
      const sim = grownTown(150);
      for (const zone of [1, 2, 3]) sim.apply({ type: 'setTax', zone, rate: 0 });
      runTicks(sim, 200);
      return { sim };
    },
    mustMention: [/tax/i],
    expectAction: ['budget'],
  },
  {
    name: 'traffic (Hindi)',
    truth: 'Evening rush hour gridlock on a street; the council has a traffic problem listed.',
    question: 'ट्रैफिक बहुत ज़्यादा है, मुझे क्या करना चाहिए?',
    script: 'hi',
    build: () => {
      const sim = grownTown(150);
      sim.traffic.hour = 18;
      runTicks(sim, 1500);
      return { sim };
    },
    mustMention: [/council|काउंसिल|परिषद/i, /avenue|एवेन्यू|सड़क|road|street/i],
    expectAction: ['council'],
  },
];

function completer(providers: Provider[]): Completer {
  return async (system, user, maxTokens) => {
    const r = await patient(providers, { system, user, maxTokens, json: true });
    return 'error' in r ? null : r;
  };
}

interface Result {
  name: string;
  truth: string;
  question: string;
  answer: string;
  actions: AssistantReply['actions'];
  source: string;
  mentions: boolean[];
  actionOk: boolean | null;
  scriptOk: boolean;
  ungrounded: number[];
  judge?: { correct: number; useful: number; grounded: number; note: string; provider: string };
}

it.runIf(RUN)(
  'assistant evaluation against the real AI',
  async () => {
    const ep = await evalProviders();
    const providers = ep.speakers;
    const judgeProviders = ep.judge;
    const results: Result[] = [];
    for (const c of CASES) {
      const { sim, refusal } = c.build();
      const issues = detectIssues(sim).map((i) => ({ key: i.key, title: i.title, severity: i.severity }));
      const ctl = new AssistantController({ sim, issues: () => issues, tool: () => 'none', hour: () => sim.traffic.hour }, completer(providers));
      if (refusal) ctl.noteCommand(refusal.cmd, sim.apply(refusal.cmd));
      const { system, user } = ctl.prompt(c.question);
      const reply = await ctl.answer(c.question);
      const text = reply.answer;
      const dev = devanagariShare(text);
      const scriptOk = c.script === 'hi' ? dev >= 0.4 : dev < 0.05;
      const res: Result = {
        name: c.name,
        truth: c.truth,
        question: c.question,
        answer: text,
        actions: reply.actions,
        source: reply.source,
        mentions: c.mustMention.map((re) => re.test(text)),
        actionOk: c.expectAction ? reply.actions.some((a) => c.expectAction!.includes(a.type)) : null,
        scriptOk,
        ungrounded: checkNumbers(text, `${system}\n${user}`).ungrounded,
      };
      // Judge: does the answer name the true cause and help?
      const j = await patient(judgeProviders, {
        system:
          'You grade answers from an in-game assistant of a city-builder. You are told the TRUE situation (how the test city was built) and the city data the assistant saw. Score 1-5: correct (identifies the true cause or gives the right first step), useful (concrete steps the player can follow in this game), grounded (no invented features or numbers). Reply JSON only: {"correct": n, "useful": n, "grounded": n, "note": "<one sentence>"}',
        user: `TRUE SITUATION: ${c.truth}\n\nCITY DATA THE ASSISTANT SAW:\n${user}\n\nANSWER:\n${text}\nBUTTONS OFFERED: ${reply.actions.map((a) => a.label).join(', ') || 'none'}`,
        maxTokens: 800,
        json: true,
      });
      if (!('error' in j)) {
        const d = parseJsonReply(j.text);
        if (d) res.judge = { correct: Number(d.correct), useful: Number(d.useful), grounded: Number(d.grounded), note: String(d.note ?? ''), provider: j.provider };
      }
      console.log(`[assistant] ${c.name}: ${res.mentions.every(Boolean) ? 'cause named' : 'MISSED'} | ${text.slice(0, 160)}`);
      results.push(res);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    mkdirSync('eval/runs', { recursive: true });
    writeFileSync(`eval/runs/assistant-${stamp}.json`, JSON.stringify({ stamp, results }, null, 1));
    const ok = (b: boolean): string => (b ? 'yes' : '**no**');
    const out: string[] = [];
    out.push('# Assistant evaluation', '');
    out.push(`Run ${stamp} (UTC). Assistant model: ${providers.map((p) => p.model).join(' → ')}; judge: ${judgeProviders[0]!.model}. Generated by \`tests/eval/assistant.eval.ts\`; raw answers in \`eval/runs/assistant-${stamp}.json\`.`, '');
    out.push('Each case is a city built with a known problem. The answer must name the true cause (keyword check), quote only figures it was given, answer in the player’s script and offer buttons that exist; a second model rates correctness, usefulness and grounding 1–5.', '');
    out.push('| Case | Cause named | Right button | Script | Unverified numbers | Judge correct / useful / grounded |');
    out.push('|---|---|---|---|---|---|');
    for (const r of results) {
      out.push(`| ${r.name} | ${ok(r.mentions.every(Boolean))} | ${r.actionOk === null ? 'n/a' : ok(r.actionOk)} | ${ok(r.scriptOk)} | ${r.ungrounded.length ? r.ungrounded.join(', ') : 'none'} | ${r.judge ? `${r.judge.correct} / ${r.judge.useful} / ${r.judge.grounded}` : '—'} |`);
    }
    const named = results.filter((r) => r.mentions.every(Boolean)).length;
    out.push('', `Cause named in ${named} of ${results.length} cases. Answers came from: ${[...new Set(results.map((r) => r.source))].join(', ')}.`, '');
    out.push('## Answers', '');
    for (const r of results) {
      out.push(`**${r.name}** — truth: ${r.truth}`, '', `> ${r.question}`, '', r.answer.replace(/\n/g, '  \n'), '');
      if (r.actions.length) out.push(`Buttons: ${r.actions.map((a) => a.label).join(' · ')}`, '');
      if (r.judge) out.push(`Judge (${r.judge.provider}): ${r.judge.note}`, '');
    }
    writeFileSync('eval/ASSISTANT_REPORT.md', out.join('\n') + '\n');
    console.log('[assistant] wrote eval/ASSISTANT_REPORT.md');
  },
  60 * 60_000,
);
