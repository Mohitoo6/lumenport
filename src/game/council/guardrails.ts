import { anyCompliant, violations, type Constraint } from './constraints';
import type { FiscalLimits } from './effects';
import { checkNumbers, lettersIn } from './grounding';
import type { MinistryId } from './ministries';
import type { CouncilOption } from './options';
import type { ChairVerdict, MinisterTurn } from './schemas';

/**
 * Zero-token guardrails: what an agent said is checked by code against the game's rules
 * and against exactly what that agent was shown. No second model grades the first.
 *
 * There are three strengths. `info` is recorded. `warn` is shown to the mayor next to the
 * statement. `block` is a hard rule of the game being broken: the recommendation is not
 * allowed to stand, and a deterministic choice replaces it.
 */
export type Strength = 'info' | 'warn' | 'block';

export interface Finding {
  check: string;
  strength: Strength;
  passed: boolean;
  detail: string;
  /** For the grounding check: how many figures were quoted and how many were not found. */
  figures?: { quoted: number; unverified: number };
}

const usd = (n: number): string => `$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

const pass = (check: string, detail: string): Finding => ({ check, strength: 'info', passed: true, detail });
const flag = (check: string, strength: Strength, detail: string): Finding => ({ check, strength, passed: false, detail });

/**
 * The hallucination check. Every figure in `said` must appear in `seen` (the prompt that
 * agent received), allowing rounding and simple sums of two given figures.
 */
function grounded(said: string, seen: string): Finding {
  const n = checkNumbers(said, seen);
  const figures = { quoted: n.checked, unverified: n.ungrounded.length };
  if (n.ungrounded.length === 0) return { ...pass('grounded_figures', n.checked ? `${n.checked} figure${n.checked > 1 ? 's' : ''} quoted, all found in the facts shown.` : 'No figures quoted.'), figures };
  const list = n.ungrounded.map((v) => v.toLocaleString('en-US'));
  return { ...flag('grounded_figures', 'warn', `${list.join(', ')} ${list.length > 1 ? 'are' : 'is'} not in the facts this speaker was shown (${n.checked - list.length} of ${n.checked} figures verified).`), figures };
}

/** The text argues for the same option the structured field names. */
function consistent(text: string, option: string, valid: readonly string[]): Finding {
  const named = lettersIn(text, valid);
  if (option === 'none' || named.length === 0 || named.includes(option)) return pass('names_its_choice', named.length ? `Text and field agree on option ${option}.` : 'No option letter in the text.');
  return flag('names_its_choice', 'warn', `The field says option ${option} but the text only mentions ${named.join(', ')}.`);
}

/** Checks one minister's statement against what that minister was shown. */
export function checkStatement(turn: MinisterTurn, seen: string, options: readonly CouncilOption[], constraints: readonly Constraint[] = []): Finding[] {
  const ids = options.map((o) => o.id);
  const out = [grounded(`${turn.say} ${turn.condition}`, seen), consistent(turn.say, turn.option, ids)];
  const backed = options.find((o) => o.id === turn.option);
  if (backed && backed.feasibility.status === 'unaffordable') out.push(flag('backs_affordable_option', 'warn', `Backs option ${backed.id}, which the city cannot pay for. ${backed.feasibility.reason}`));
  const broken = backed ? violations(backed, constraints) : [];
  if (backed && broken.length) out.push(flag('respects_mayor_instruction', 'warn', `Backs option ${backed.id}, which ${broken.join(' and ')}: against the mayor's instruction.`));
  return out;
}

export interface VerdictReport {
  /** pass: nothing to say. flagged: stands, with warnings. overridden: a hard rule was broken and code chose instead. */
  status: 'pass' | 'flagged' | 'overridden';
  /** The option after the guardrails, and what the chair originally said. */
  option: string;
  original: string;
  overrideReason?: string;
  findings: Finding[];
}

/** The hard money and validity rules for one option. */
export function checkOption(option: CouncilOption, limits: FiscalLimits): Finding[] {
  const out: Finding[] = [];
  const spend = Math.max(0, -option.effects.budgetDelta);
  const f = option.feasibility;
  out.push(f.status === 'blocked' ? flag('executable', 'block', f.reason) : pass('executable', option.actions.length ? `All ${option.actions.length} command${option.actions.length > 1 ? 's' : ''} ran on a fork of the city.` : 'Nothing to execute.'));
  if (limits.sandbox) {
    out.push(pass('within_spend_ceiling', 'Sandbox city: money is unlimited.'));
    return out;
  }
  out.push(
    spend > limits.spendCeiling
      ? flag('within_spend_ceiling', 'block', `Spends ${usd(spend)}; the ceiling is ${usd(limits.spendCeiling)} (treasury ${usd(limits.treasury)} + loans still available ${usd(limits.loanHeadroom)}).`)
      : pass('within_spend_ceiling', `Spends ${usd(spend)} of a ${usd(limits.spendCeiling)} ceiling (treasury + available loans).`),
  );
  out.push(
    spend > limits.treasury && spend <= limits.spendCeiling
      ? flag('affordable_now', 'warn', `Needs ${usd(spend - limits.treasury)} more than the treasury holds: a loan has to come first.`)
      : pass('affordable_now', spend > 0 ? `The treasury (${usd(limits.treasury)}) covers it.` : 'No upfront spending.'),
  );
  // What is left, against the hourly balance the option leaves behind.
  const left = limits.treasury + option.effects.budgetDelta;
  const net = limits.hourlyNet + option.effects.hourlyNetDelta;
  if (spend <= limits.treasury && net < 0) {
    const hours = Math.floor(left / -net);
    out.push(hours < 6 ? flag('keeps_runway', 'warn', `Leaves ${usd(left)} with the city losing ${usd(net)} an hour: about ${Math.max(0, hours)} hours of money.`) : pass('keeps_runway', `Leaves about ${hours} hours of money at ${usd(net)} an hour.`));
  } else if (spend <= limits.treasury) out.push(pass('keeps_runway', `Leaves ${usd(left)} and an hourly balance of ${net < 0 ? '-' : '+'}${usd(net)}.`));
  return out;
}

/**
 * The option code would choose: the best-backed option that passes every hard rule, ties
 * broken by the order on the table, falling back to "take no action", which always passes.
 */
export function safestBacked(options: readonly CouncilOption[], tally: Record<string, MinistryId[]>, limits: FiscalLimits, exclude: string, constraints: readonly Constraint[] = []): CouncilOption {
  const ok = options.filter((o) => o.id !== exclude && checkOption(o, limits).every((f) => f.passed || f.strength !== 'block') && o.feasibility.status !== 'needs_loan' && violations(o, constraints).length === 0);
  const ranked = ok.filter((o) => o.actions.length > 0).sort((a, b) => (tally[b.id]?.length ?? 0) - (tally[a.id]?.length ?? 0));
  return ranked.find((o) => (tally[o.id]?.length ?? 0) > 0) ?? ranked[0] ?? options[options.length - 1]!;
}

/**
 * The mayor's instruction as a rule. Breaking it is a hard violation when another option
 * that acts would respect it; when none would, the instruction cannot be met and the
 * mayor is told so instead.
 */
export function checkInstruction(option: CouncilOption, options: readonly CouncilOption[], constraints: readonly Constraint[]): Finding | null {
  if (constraints.length === 0) return null;
  const broken = violations(option, constraints);
  const rules = constraints.map((c) => c.label).join('; ');
  if (broken.length === 0) return pass('respects_mayor_instruction', `Meets the mayor's instruction (${rules}).`);
  if (option.actions.length === 0) return pass('respects_mayor_instruction', `Takes no action, which breaks nothing in the mayor's instruction (${rules}).`);
  return anyCompliant(options, constraints)
    ? flag('respects_mayor_instruction', 'block', `Option ${option.id} ${broken.join(' and ')}, against the mayor's instruction (${rules}).`)
    : flag('respects_mayor_instruction', 'warn', `Option ${option.id} ${broken.join(' and ')}. No option that acts meets the mayor's instruction (${rules}).`);
}

/**
 * Checks the chair's recommendation. Hard rules first: the option must exist, the game
 * must accept it, and it must not spend more than the treasury plus every loan the city
 * could still take. If one is broken the recommendation is replaced, and the report says
 * so. Then the softer checks: figures quoted must be in the facts shown, the text must
 * argue for the option named, and a split council must have its dissent recorded.
 */
export function checkVerdict(
  verdict: ChairVerdict,
  ctx: { options: readonly CouncilOption[]; limits: FiscalLimits; seen: string; tally: Record<string, MinistryId[]>; constraints?: readonly Constraint[] },
): VerdictReport {
  const { options, limits, tally } = ctx;
  const constraints = ctx.constraints ?? [];
  const ids = options.map((o) => o.id);
  const findings: Finding[] = [];
  const chosen = options.find((o) => o.id === verdict.option);
  if (!chosen) {
    const safe = safestBacked(options, tally, limits, verdict.option, constraints);
    return {
      status: 'overridden',
      option: safe.id,
      original: verdict.option,
      overrideReason: `Option ${verdict.option} is not on the table. The best-backed valid option is ${safe.id}.`,
      findings: [flag('option_on_table', 'block', `"${verdict.option}" is not one of ${ids.join(', ')}.`)],
    };
  }
  findings.push(pass('option_on_table', `Option ${chosen.id} is one of ${ids.join(', ')}.`), ...checkOption(chosen, limits));
  const instruction = checkInstruction(chosen, options, constraints);
  if (instruction) findings.push(instruction);
  findings.push(grounded(`${verdict.summary} ${verdict.dissent} ${verdict.conditions}`, ctx.seen), consistent(verdict.summary, verdict.option, ids));
  const others = Object.entries(tally).filter(([id, ms]) => id !== chosen.id && ms.length > 0);
  if (others.length > 0) {
    findings.push(verdict.dissent.trim() ? pass('dissent_recorded', `${others.reduce((a, [, ms]) => a + ms.length, 0)} minister(s) back another option and the dissent is recorded.`) : flag('dissent_recorded', 'warn', `Ministers back ${others.map(([id]) => id).join(', ')} too, but no dissent was recorded.`));
  }
  const blocks = findings.filter((f) => !f.passed && f.strength === 'block');
  if (blocks.length > 0) {
    const safe = safestBacked(options, tally, limits, chosen.id, constraints);
    return {
      status: 'overridden',
      option: safe.id,
      original: chosen.id,
      overrideReason: `${blocks.map((b) => b.detail).join(' ')} The council's recommendation was replaced by option ${safe.id}, the best-backed option that passes the rules.`,
      findings,
    };
  }
  return { status: findings.some((f) => !f.passed) ? 'flagged' : 'pass', option: chosen.id, original: chosen.id, findings };
}
