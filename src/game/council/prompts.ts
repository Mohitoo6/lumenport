import type { CityIssue } from './issues';
import { CHIEF_SECRETARY, MINISTER_BY_ID, type MinistryId } from './ministries';
import type { CouncilOption } from './options';

export type Lang = 'en' | 'hi';

export type Stance = 'propose' | 'support' | 'concern' | 'oppose' | 'neutral';

/** One minister's contribution in one round. */
export interface Statement {
  minister: MinistryId;
  round: 1 | 2;
  stance: Stance;
  /** The option they back, or 'none'. */
  option: string;
  text: string;
  condition: string;
}

const money = (n: number): string => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

function languageRule(lang: Lang): string {
  return lang === 'hi'
    ? 'Write "statement" (and any other prose) in natural spoken Hindi in Devanagari script, as a minister would speak in a council meeting. Keep option letters (A, B, C), numbers, money and street names exactly as given.'
    : 'Write in plain, natural English, as a minister would speak in a council meeting.';
}

/** The options as every participant sees them. */
export function describeOptions(options: readonly CouncilOption[]): string {
  return options
    .map((o) => {
      const money1 = o.cost > 0 ? `costs ${money(o.cost)} now` : o.cost < 0 ? `brings in ${money(-o.cost)} now` : 'no upfront cost';
      const money2 = o.monthly > 0 ? `${money(o.monthly)} a month more spending` : o.monthly < 0 ? `${money(-o.monthly)} a month better off` : 'no monthly change';
      return `Option ${o.id}: ${o.title}. ${money1}; ${money2}.\n  - ${o.facts.join('\n  - ')}`;
    })
    .join('\n');
}

export function describeIssue(issue: CityIssue): string {
  return `${issue.title}. ${issue.summary}\nMeasured facts:\n- ${issue.facts.join('\n- ')}`;
}

/** The fixed part of every minister's instructions: who they are and how the council works. */
export function ministerSystem(id: MinistryId, city: string, lang: Lang): string {
  const m = MINISTER_BY_ID[id];
  return [
    `You are ${m.name}, ${m.title} of the city of ${city}. You sit on the mayor's council. The mayor is the player; you advise, the mayor decides.`,
    `Your mandate: ${m.mandate}`,
    `Your priorities: ${m.priorities.join('; ')}.`,
    `You will not accept: ${m.redLines.join('; ')}.`,
    `How you speak: ${m.style}`,
    '',
    'How the council works:',
    '- Argue only from the facts you are given: the issue, the options and your department’s figures. Never invent numbers, places, buildings, budgets or options. If a fact you would need is missing, say so instead of guessing.',
    '- Only the listed options (A, B, C...) can be carried out. You may attach one short condition, but it is advice, not a new option.',
    '- Speak only if this matter really touches your portfolio. If it does not, or someone has already said what you would say, set "speak" to false and leave "statement" empty. Silence is normal and respected.',
    '- Agree when you agree. Object only for a concrete reason within your mandate, and name the option and the number behind it. Do not lecture other ministers about their own portfolios.',
    '- Weigh trade-offs honestly: a cheaper option that does not solve the problem is not good value; an option with a real cost to residents needs a real reason.',
    '- 2 to 4 sentences, first person, addressed to the mayor and colleagues. No lists, no markdown, no greetings.',
    `- ${languageRule(lang)}`,
    '',
    'Reply with one JSON object and nothing else:',
    '{"speak": true|false, "stance": "propose"|"support"|"concern"|"oppose"|"neutral", "option": "<the option letter you back, or none>", "statement": "<what you say>", "condition": "<one short condition, or empty>"}',
    '"option" is always the letter of the option you SUPPORT, never the one you object to. If you object to A and prefer B, set "stance": "oppose" and "option": "B".',
    'Use "propose" when you are putting forward an option, "support" when backing a colleague’s choice, "concern" when you back an option with reservations, "oppose" when you object to the option others favour (and name the one you back instead).',
  ].join('\n');
}

export function chiefSystem(city: string, lang: Lang): string {
  return [
    `You are ${CHIEF_SECRETARY.name}, ${CHIEF_SECRETARY.title} of ${city}: the senior civil servant who chairs the mayor's council and advises the mayor impartially.`,
    'After the ministers have spoken, you sum up for the mayor and recommend exactly one of the listed options.',
    '- Recommend the option that best solves the problem while respecting the concerns raised. Weigh severity, cost, how many residents are affected, and any red lines ministers invoked.',
    '- Usually that is the option most ministers can live with, but not if a well-founded objection shows it would cause more harm than it fixes.',
    '- Use only the facts given. Do not invent numbers or options.',
    '- Be brief and neutral: 3 to 4 sentences of summary, then the dissent (who still disagrees and why, in one sentence, or empty) and any conditions ministers asked for (one sentence, or empty).',
    `- ${languageRule(lang)}`,
    '',
    'Reply with one JSON object and nothing else:',
    '{"option": "<letter>", "summary": "<what the council concluded and why>", "dissent": "<or empty>", "conditions": "<or empty>"}',
  ].join('\n');
}

function transcript(statements: readonly Statement[]): string {
  if (statements.length === 0) return '(nobody else has spoken yet)';
  return statements
    .map((s) => {
      const m = MINISTER_BY_ID[s.minister];
      const backs = s.option !== 'none' ? ` [backs option ${s.option}]` : '';
      const cond = s.condition ? ` Condition: ${s.condition}` : '';
      return `${m.name} (${m.short}), round ${s.round}${backs}: "${s.text}"${cond}`;
    })
    .join('\n');
}

export interface TurnContext {
  issue: CityIssue;
  options: readonly CouncilOption[];
  briefing: readonly string[];
  /** Why this minister was called in. */
  reason: string;
  mayorNote: string;
  /** What has been said so far. */
  earlier: readonly Statement[];
}

export function ministerTurn(id: MinistryId, round: 1 | 2, lead: MinistryId, ctx: TurnContext): string {
  const m = MINISTER_BY_ID[id];
  const isLead = id === lead;
  const parts = [
    `COUNCIL MEETING: ${describeIssue(ctx.issue)}`,
    ctx.mayorNote ? `The mayor's instruction to the council: "${ctx.mayorNote}". Take it seriously.` : 'The mayor has given no special instruction.',
    `OPTIONS ON THE TABLE:\n${describeOptions(ctx.options)}`,
    `YOUR DEPARTMENT'S FIGURES (${m.short}):\n- ${ctx.briefing.join('\n- ')}`,
  ];
  if (round === 1 && isLead) {
    parts.push('You raised this issue. Open the meeting: state the problem in your own terms, recommend one option and say why. You must speak (set "speak": true, "stance": "propose").');
  } else if (round === 1) {
    parts.push(`You were called in because ${ctx.reason}.`);
    parts.push(`SAID SO FAR:\n${transcript(ctx.earlier)}`);
    parts.push('Round 1. Give your view from your portfolio, or stay silent if it is not affected.');
  } else {
    parts.push(`DISCUSSION SO FAR:\n${transcript(ctx.earlier)}`);
    parts.push(
      isLead
        ? 'Round 2, the final round. Respond to the concerns raised: hold your recommendation, adjust it, or switch to another option if a colleague made a better case. State which option you now back.'
        : 'Round 2, the final round. Respond to colleagues where your portfolio is affected and state which option you now back. If you simply agree with where the council is heading, say so in one sentence; if you have nothing new, stay silent.',
    );
  }
  return parts.join('\n\n');
}

export function chiefTurn(ctx: TurnContext, tally: string): string {
  return [
    `COUNCIL MEETING: ${describeIssue(ctx.issue)}`,
    ctx.mayorNote ? `The mayor's instruction to the council: "${ctx.mayorNote}".` : 'The mayor gave no special instruction.',
    `OPTIONS:\n${describeOptions(ctx.options)}`,
    `DISCUSSION:\n${transcript(ctx.earlier)}`,
    `WHERE MINISTERS STAND AT THE END: ${tally}`,
    'Sum up and recommend one option to the mayor.',
  ].join('\n\n');
}
