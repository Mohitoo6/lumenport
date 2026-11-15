import { violations, type Constraint } from './constraints';
import type { FiscalLimits } from './effects';
import type { CityIssue } from './issues';
import { CHIEF_SECRETARY, MINISTER_BY_ID, type Lens, type MinistryId } from './ministries';
import type { CouncilOption } from './options';
import type { Lang } from './policy';
import type { Stance } from './schemas';

export type { Lang } from './policy';
export type { Stance } from './schemas';

/**
 * Prompt builders. Two rules shape them.
 *
 * Isolation: an agent is shown the issue, the shared money limits, its own department's
 * figures, and each option through its own lens (the slices of the effect payload that
 * belong to its portfolio). It is not shown the other departments' figures, so it cannot
 * argue from them.
 *
 * Economy: every line is something an agent can act on. Facts are stated once, numbers
 * come from the payload rather than prose, earlier speeches are passed on as one line
 * each, and the reply is capped at two sentences. Token counts per meeting are in
 * `tests/game/tokens.test.ts`.
 */

/** One minister's contribution in one round. */
export interface Statement {
  minister: MinistryId;
  round: 1 | 2;
  stance: Stance;
  /** The option they back, or 'none'. */
  option: string;
  text: string;
  condition: string;
  /** True when a deterministic stand-in spoke because the model could not. */
  standIn?: boolean;
  /** What the guardrails flagged in this statement, in words. */
  flags?: string[];
}

const money = (n: number): string => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const signed = (n: number): string => `${n < 0 ? '-' : '+'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

function languageRule(lang: Lang): string {
  return lang === 'hi' ? 'Write "say" and other prose in natural spoken Hindi in Devanagari script; keep option letters, numbers, money and street names exactly as given.' : 'Plain spoken English.';
}

/** The shared constraint every agent argues within. */
export function budgetLine(limits: FiscalLimits): string {
  if (limits.sandbox) return 'BUDGET: sandbox city, money is unlimited.';
  const runway = limits.runwayMonths !== null ? ` (about ${limits.runwayMonths} months of money left)` : '';
  return `BUDGET: treasury ${money(limits.treasury)}; monthly balance ${signed(limits.monthlyNet)}${runway}; the city can still borrow ${money(limits.loanHeadroom)}.`;
}

const ALL_LENSES: Lens[] = ['money', 'displacement', 'health', 'schools', 'environment', 'utilities', 'traffic', 'tax', 'approval', 'zoning'];

/** The parts of an option's effect payload that fall inside a lens. Empty parts are left out. */
function lensItems(o: CouncilOption, lens: readonly Lens[], limits: FiscalLimits): string[] {
  const e = o.effects;
  const im = o.impact;
  const out: string[] = [];
  const has = (l: Lens): boolean => lens.includes(l);
  if (has('money')) {
    if (e.budgetDelta !== 0 && !limits.sandbox) out.push(`treasury after ${money(limits.treasury + e.budgetDelta)}`);
    if (e.debtDelta > 0) out.push(`new debt ${money(e.debtDelta)}`);
  }
  if (has('displacement')) {
    if (e.buildingsDemolished > 0) out.push(`demolishes ${e.buildingsDemolished} building${e.buildingsDemolished > 1 ? 's' : ''}`);
    if (e.residentsDisplaced > 0) out.push(`${e.residentsDisplaced} residents displaced`);
    if (e.jobsLost > 0) out.push(`${e.jobsLost} jobs lost`);
    if (o.actions.length > 0 && e.residentsDisplaced === 0 && e.jobsLost === 0) out.push('nobody displaced');
  }
  if (has('health')) {
    if (im.clinicM < 600) out.push(`${Math.round(im.clinicM)} m from the nearest clinic`);
    if (im.pollutes && !has('environment')) out.push('adds a polluter near homes');
  }
  if (has('schools') && im.schoolM < 600) out.push(`${Math.round(im.schoolM)} m from the nearest school`);
  if (has('environment')) {
    if (im.pollutes) out.push('adds a polluter near homes');
    if (im.treesCleared > 3) out.push(`clears trees on ${im.treesCleared} plots`);
    if (im.green) out.push('a green option');
  }
  if (has('utilities')) {
    if (e.powerSupplyDelta !== 0) out.push(`power supply ${e.powerSupplyDelta > 0 ? '+' : ''}${e.powerSupplyDelta} MW`);
    if (e.waterSupplyDelta !== 0) out.push(`water supply ${e.waterSupplyDelta > 0 ? '+' : ''}${e.waterSupplyDelta.toLocaleString('en-US')} units`);
  }
  if (has('traffic')) {
    if (e.trafficImpact.capacityDelta !== 0) out.push(`road capacity ${e.trafficImpact.capacityDelta > 0 ? '+' : ''}${e.trafficImpact.capacityDelta} vehicles`);
    if (e.trafficImpact.rushPeakFactor !== 1) out.push(`rush-hour peak at ${Math.round(e.trafficImpact.rushPeakFactor * 100)}% of today's`);
  }
  if (has('tax') && e.taxRateDelta.some((d) => d !== 0)) out.push(`tax ${e.taxRateDelta.map((d) => (d > 0 ? `+${d}` : String(d))).join('/')} points (homes/shops/industry)`);
  if (has('approval') && e.approvalDelta !== 0) out.push(`city happiness ${e.approvalDelta > 0 ? '+' : ''}${e.approvalDelta} points`);
  if (has('zoning') && im.zoning) out.push('changes land use');
  return out;
}

/** Upfront and monthly money: shown to everyone, because the budget is everyone's limit. */
function moneyOf(o: CouncilOption, constraints: readonly Constraint[] = []): string {
  const now = o.cost > 0 ? `${money(o.cost)} now` : o.cost < 0 ? `brings in ${money(-o.cost)} now` : 'free now';
  const monthly = o.monthly > 0 ? `, ${money(o.monthly)}/month more` : o.monthly < 0 ? `, ${money(-o.monthly)}/month better` : '';
  const flag = o.feasibility.status === 'unaffordable' ? ' NOT AFFORDABLE' : o.feasibility.status === 'needs_loan' ? ` NEEDS A LOAN of ${money(o.feasibility.shortfall)} first` : '';
  // What the mayor ruled out is marked on the option itself, for every agent.
  const broken = violations(o, constraints);
  const against = broken.length ? ` AGAINST THE MAYOR'S INSTRUCTION: ${broken.join(', ')}` : '';
  return `${now}${monthly}${flag}${against}`;
}

/** One option as one line, seen through a lens. */
function optionLine(o: CouncilOption, lens: readonly Lens[], limits: FiscalLimits, constraints: readonly Constraint[]): string {
  const items = lensItems(o, lens, limits);
  return `${o.id}. ${o.title} (${moneyOf(o, constraints)}). ${o.gist}${items.length ? ` [${items.join('; ')}]` : ''}`;
}

/** The options as the lead sees them: every fact, since the lead has to propose one. */
export function describeOptions(options: readonly CouncilOption[], constraints: readonly Constraint[] = []): string {
  return options.map((o) => `${o.id}. ${o.title} (${moneyOf(o, constraints)}).\n  - ${o.facts.join('\n  - ')}`).join('\n');
}

/** The options through one ministry's lens, or through all of them for the chair. */
export function describeOptionsFor(options: readonly CouncilOption[], lens: readonly Lens[] | 'all', limits: FiscalLimits, constraints: readonly Constraint[] = []): string {
  return options.map((o) => optionLine(o, lens === 'all' ? ALL_LENSES : lens, limits, constraints)).join('\n');
}

/** The mayor's instruction as the agents see it: the words, and what code will hold them to. */
function mayorLine(note: string, constraints: readonly Constraint[]): string {
  const rules = constraints.length ? ` Enforced by rule: ${constraints.map((c) => c.label).join('; ')}.` : '';
  return `MAYOR'S INSTRUCTION: "${note}".${rules} Respect it.`;
}

/** The issue with every fact (lead and chair), or only the facts that concern one ministry. */
export function describeIssue(issue: CityIssue, forMinistry?: MinistryId): string {
  const facts = forMinistry ? issue.facts.filter((_, i) => !issue.factsFor?.[i] || issue.factsFor[i]!.includes(forMinistry)) : issue.facts;
  return `${issue.title}. ${issue.summary}\n- ${facts.join('\n- ')}`;
}

/** Who a minister is and how to answer. Fixed for the meeting. */
export function ministerSystem(id: MinistryId, city: string, lang: Lang): string {
  const m = MINISTER_BY_ID[id];
  return [
    `You are ${m.name}, ${m.title} of ${city}, on the mayor's council. The mayor decides; you advise.`,
    `Objective: ${m.objective}`,
    `Red line: ${m.redLines.join('; ')}.`,
    `Voice: ${m.style}`,
    `Rules: argue only from the facts given; never invent a number, place or option. Back exactly one listed option. Object only from your own portfolio, naming the option and the figure behind it. At most 2 sentences (45 words), first person, to the mayor. No lists, no greetings. ${languageRule(lang)}`,
    'Reply with JSON only: {"speak":true,"stance":"propose|support|concern|oppose","option":"<letter you back>","say":"<your words>","condition":"<one short condition, or empty>"}',
    '"option" is the one you back, never the one you object to. If your portfolio is untouched: "speak":false and "say":"".',
  ].join('\n');
}

export function chiefSystem(city: string, lang: Lang): string {
  return [
    `You are ${CHIEF_SECRETARY.name}, ${CHIEF_SECRETARY.title} of ${city}: the impartial civil servant who chairs the mayor's council.`,
    "Recommend exactly one listed option: the one that best fixes the problem within the budget while respecting well-founded objections. Usually that is the one most ministers can live with. Never recommend an option marked NOT AFFORDABLE or AGAINST THE MAYOR'S INSTRUCTION if another option is free of it.",
    `Use only the facts given; invent nothing. ${languageRule(lang)}`,
    'Reply with JSON only: {"option":"<letter>","summary":"<at most 3 sentences: what the council concluded and why>","dissent":"<who still disagrees and why, or empty>","conditions":"<conditions ministers asked for, or empty>"}',
  ].join('\n');
}

/** What has been said, one line per statement. Rounds are marked once there are two. */
function digest(statements: readonly Statement[]): string {
  const two = statements.some((s) => s.round === 2);
  return statements
    .map((s) => {
      const backs = s.option !== 'none' ? ` backs ${s.option}` : '';
      return `${two ? `R${s.round} ` : ''}${MINISTER_BY_ID[s.minister].short}${backs} (${s.stance}): "${s.text}"${s.condition ? ` If: ${s.condition}` : ''}`;
    })
    .join('\n');
}

export interface TurnContext {
  issue: CityIssue;
  options: readonly CouncilOption[];
  limits: FiscalLimits;
  /** This department's own figures. */
  briefing: readonly string[];
  /** Why this minister was called in. */
  reason: string;
  mayorNote: string;
  /** What has been said so far. */
  earlier: readonly Statement[];
  /** Past decisions relevant to this agent, one line each. */
  memory: readonly string[];
  /** The parts of the mayor's instruction that code enforces. */
  constraints?: readonly Constraint[];
}

export function ministerTurn(id: MinistryId, round: 1 | 2, lead: MinistryId, ctx: TurnContext): string {
  const m = MINISTER_BY_ID[id];
  const isLead = id === lead;
  const parts = [
    `ISSUE: ${describeIssue(ctx.issue, isLead ? undefined : id)}`,
    budgetLine(ctx.limits),
    // The lead has to propose, so opens with every fact of every option. The others see
    // each option through their own lens. In round 2 the lead answers challenges from
    // other portfolios, so sees the one-line form with every lens.
    `OPTIONS:\n${isLead && round === 1 ? describeOptions(ctx.options, ctx.constraints) : describeOptionsFor(ctx.options, isLead ? 'all' : m.lens, ctx.limits, ctx.constraints)}`,
    `YOUR DEPARTMENT (${m.short}): ${ctx.briefing.join(' ')}`,
  ];
  if (ctx.memory.length) parts.push(`PAST DECISIONS:\n${ctx.memory.join('\n')}`);
  if (ctx.mayorNote) parts.push(mayorLine(ctx.mayorNote, ctx.constraints ?? []));
  if (round === 1 && isLead) {
    parts.push('You raised this. Open the meeting: put the problem in your own terms, propose one option and say why. "speak":true, "stance":"propose".');
  } else if (round === 1) {
    parts.push(`SAID SO FAR:\n${digest(ctx.earlier)}`);
    parts.push(`You were called in because ${ctx.reason}. Give your portfolio's view.`);
  } else {
    parts.push(`DEBATE SO FAR:\n${digest(ctx.earlier)}`);
    parts.push(isLead ? 'Final round. Colleagues have challenged your proposal. Hold it, adjust it or switch, and name the option you now back.' : 'Final round. You have now heard the others. Hold or switch, and name the option you now back.');
  }
  return parts.join('\n\n');
}

export function chiefTurn(ctx: TurnContext, tally: string): string {
  const parts = [`ISSUE: ${describeIssue(ctx.issue)}`, budgetLine(ctx.limits), `OPTIONS:\n${describeOptionsFor(ctx.options, 'all', ctx.limits, ctx.constraints)}`];
  if (ctx.memory.length) parts.push(`PAST DECISIONS:\n${ctx.memory.join('\n')}`);
  if (ctx.mayorNote) parts.push(mayorLine(ctx.mayorNote, ctx.constraints ?? []));
  parts.push(`DEBATE:\n${digest(ctx.earlier)}`, `WHERE MINISTERS STAND: ${tally}`, 'Sum up and recommend one option to the mayor.');
  return parts.join('\n\n');
}
