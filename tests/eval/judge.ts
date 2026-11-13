import { CHIEF_SECRETARY, MINISTER_BY_ID, type MinistryId } from '../../src/game/council/ministries';
import { describeIssue, describeOptions } from '../../src/game/council/prompts';
import type { CityIssue } from '../../src/game/council/issues';
import type { CouncilOption } from '../../src/game/council/options';
import { parseJsonReply } from '../../src/game/council/llm';

/**
 * LLM-as-judge for a whole meeting. The judge sees exactly the evidence the ministers had
 * (issue facts, options, each department's figures) and scores every statement against a
 * fixed rubric. It is run on a different model family from the speakers where possible.
 */

export interface JudgedLine {
  id: string;
  speaker: MinistryId | 'chief';
  round: number;
  text: string;
  option: string;
}

export interface Verdict {
  id: string;
  /** 1-5: every factual claim is supported by the evidence. */
  grounded: number;
  /** 1-5: about this issue and these options. */
  on_topic: number;
  /** 1-5: argues from the speaker's own portfolio. */
  in_role: number;
  /** 1-5: specific, weighs a real trade-off, names the option and the figure behind it. */
  reasoning: number;
  /** Claims the evidence does not support, quoted. Empty if none. */
  unsupported: string[];
}

export function judgeSystem(): string {
  return [
    'You are an exacting reviewer auditing an AI simulation of a city council. Ministers were told to argue ONLY from the evidence given to them. Your job is to check whether they did.',
    'Score each statement from 1 (bad) to 5 (excellent) on four criteria:',
    '- grounded: every number, place, building and claim of fact appears in, or follows directly from, the evidence. Invented figures, invented consequences presented as fact, or numbers that do not match score 1-2. Opinions and judgements are fine.',
    '- on_topic: it addresses this issue and the listed options, not something else.',
    "- in_role: it argues from the speaker's own portfolio and mandate (given below) rather than another minister's.",
    '- reasoning: it is specific (names an option and the figure behind its view) and weighs a real trade-off rather than repeating generalities.',
    'For the Chief Secretary, read in_role as "summarises the discussion faithfully and neutrally".',
    'List under "unsupported" any claims you could not find in the evidence (quote them briefly). Be strict but fair: a correctly rounded figure, or a sum of two given figures, is supported.',
    'Reply with JSON only: {"verdicts": [{"id": "...", "grounded": n, "on_topic": n, "in_role": n, "reasoning": n, "unsupported": ["..."]}]}',
  ].join('\n');
}

export function judgeUser(input: {
  issue: CityIssue;
  options: readonly CouncilOption[];
  briefings: Partial<Record<MinistryId, string[]>>;
  mayorNote: string;
  lines: readonly JudgedLine[];
}): string {
  const speakers = [...new Set(input.lines.map((l) => l.speaker))];
  const roles = speakers
    .map((id) => {
      if (id === 'chief') return `- ${CHIEF_SECRETARY.name} (Chief Secretary): neutral chair, recommends one option.`;
      const m = MINISTER_BY_ID[id];
      return `- ${m.name} (${m.short}): ${m.mandate}\n  Department figures: ${(input.briefings[id] ?? []).join('; ')}`;
    })
    .join('\n');
  const lines = input.lines
    .map((l) => {
      const who = l.speaker === 'chief' ? `${CHIEF_SECRETARY.name} (Chief Secretary)` : `${MINISTER_BY_ID[l.speaker].name} (${MINISTER_BY_ID[l.speaker].short})`;
      return `[${l.id}] round ${l.round}, ${who}, backs ${l.option}: "${l.text}"`;
    })
    .join('\n');
  return [
    `EVIDENCE: THE ISSUE\n${describeIssue(input.issue)}`,
    input.mayorNote ? `The mayor's instruction: "${input.mayorNote}"` : 'No instruction from the mayor.',
    `EVIDENCE: THE OPTIONS\n${describeOptions(input.options)}`,
    `SPEAKERS AND THEIR EVIDENCE\n${roles}`,
    `STATEMENTS TO SCORE\n${lines}`,
  ].join('\n\n');
}

export function parseVerdicts(text: string, ids: readonly string[]): Verdict[] {
  const data = parseJsonReply(text) as { verdicts?: unknown } | null;
  const list = Array.isArray(data?.verdicts) ? (data!.verdicts as Array<Record<string, unknown>>) : [];
  const score = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(1, Math.min(5, Math.round(n))) : NaN;
  };
  return list
    .filter((v) => typeof v.id === 'string' && ids.includes(v.id))
    .map((v) => ({
      id: v.id as string,
      grounded: score(v.grounded),
      on_topic: score(v.on_topic),
      in_role: score(v.in_role),
      reasoning: score(v.reasoning),
      unsupported: Array.isArray(v.unsupported) ? v.unsupported.map(String).filter((s) => s.trim().length > 0) : [],
    }));
}
