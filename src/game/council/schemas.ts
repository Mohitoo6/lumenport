import { z } from 'zod';

/**
 * The contracts between the language model and the game.
 *
 * Every agent turn must come back as one of these objects. Each schema is used three ways:
 * converted to JSON Schema and sent to the provider as a structured-output constraint;
 * used to validate the reply at runtime; and used as the TypeScript type the rest of the
 * game works with. A reply that does not fit is first repaired by plain code (never by
 * asking the model again, which would cost tokens); if it still does not fit, the turn is
 * handed to the deterministic stand-in agent.
 */

export const STANCES = ['propose', 'support', 'concern', 'oppose', 'neutral'] as const;
export type Stance = (typeof STANCES)[number];

/** Characters. Two short sentences fit comfortably; a rambling reply does not. */
export const SAY_MAX = 520;
export const CONDITION_MAX = 160;
export const SUMMARY_MAX = 720;
export const NOTE_MAX = 320;

const letters = (ids: readonly string[]): [string, ...string[]] => [ids[0] ?? 'A', ...ids.slice(1)];

/** One minister's turn. `option` can only be a letter that is actually on the table. */
export function ministerTurnSchema(optionIds: readonly string[]) {
  return z
    .object({
      speak: z.boolean(),
      stance: z.enum(STANCES),
      option: z.enum([...letters(optionIds), 'none']),
      say: z.string().max(SAY_MAX),
      condition: z.string().max(CONDITION_MAX),
    })
    .strict();
}

/** The chair's recommendation: exactly one option on the table, never "none". */
export function chairVerdictSchema(optionIds: readonly string[]) {
  return z
    .object({
      option: z.enum(letters(optionIds)),
      summary: z.string().min(1).max(SUMMARY_MAX),
      dissent: z.string().max(NOTE_MAX),
      conditions: z.string().max(NOTE_MAX),
    })
    .strict();
}

export interface MinisterTurn {
  speak: boolean;
  stance: Stance;
  option: string;
  say: string;
  condition: string;
}

export interface ChairVerdict {
  option: string;
  summary: string;
  dissent: string;
  conditions: string;
}

/** JSON Schema for a provider's structured-output mode. */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

export type SchemaOutcome = 'pass' | 'repaired' | 'fail';

export interface Parsed<T> {
  /** pass: valid as sent. repaired: valid after deterministic fixes. fail: unusable. */
  outcome: SchemaOutcome;
  data: T | null;
  /** What had to be fixed, in words, for the telemetry panel. */
  repairs: string[];
  errors: string[];
}

/** The first complete JSON object in a reply, whatever surrounds it. */
export function extractJson(raw: string): { value: Record<string, unknown>; wrapped: boolean } | null {
  const text = raw.trim();
  const attempt = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s) as unknown;
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const direct = attempt(text);
  if (direct) return { value: direct, wrapped: false };
  // Walk to the brace that closes the first one, skipping braces inside strings.
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      const v = attempt(text.slice(start, i + 1));
      return v ? { value: v, wrapped: true } : null;
    }
  }
  return null;
}

/** Cuts a text to a limit at the end of a sentence where it can. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('। '));
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '')).trim();
}

const ALIASES: Record<string, string> = { statement: 'say', text: 'say', message: 'say', speech: 'say', choice: 'option', recommendation: 'option', recommend: 'option', conditions_: 'condition' };

function optionLetter(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase().replace(/^OPTION\s+/, '').replace(/[.:)]$/, '') : '';
}

function issuesOf(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join('.') || 'reply'}: ${i.message}`);
}

/**
 * Validates one minister's reply. Fixes what can be fixed without changing its meaning
 * (code fences, a renamed key, "Option B" for "B", a missing optional field, an overlong
 * statement), records each fix, then checks the result against the strict schema.
 */
export function parseMinisterTurn(raw: string, optionIds: readonly string[]): Parsed<MinisterTurn> {
  const repairs: string[] = [];
  const found = extractJson(raw);
  if (!found) return { outcome: 'fail', data: null, repairs, errors: ['the reply holds no JSON object'] };
  if (found.wrapped) repairs.push('removed text around the JSON object');
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(found.value)) {
    const key = ALIASES[k] ?? k;
    if (key !== k) repairs.push(`renamed "${k}" to "${key}"`);
    if (['speak', 'stance', 'option', 'say', 'condition'].includes(key)) o[key] = v;
    else repairs.push(`dropped unknown field "${k}"`);
  }
  if (typeof o.speak !== 'boolean') {
    const s = String(o.speak ?? '').toLowerCase();
    o.speak = o.speak === undefined ? typeof o.say === 'string' && o.say.trim() !== '' : s === 'true' || s === '1' || s === 'yes';
    repairs.push('"speak" was not a boolean');
  }
  const stance = typeof o.stance === 'string' ? o.stance.trim().toLowerCase() : '';
  if (stance !== o.stance) {
    if (!(STANCES as readonly string[]).includes(stance)) repairs.push(`unknown stance "${String(o.stance ?? '')}" read as neutral`);
    o.stance = (STANCES as readonly string[]).includes(stance) ? stance : 'neutral';
  } else if (!(STANCES as readonly string[]).includes(stance)) {
    repairs.push(`unknown stance "${stance}" read as neutral`);
    o.stance = 'neutral';
  }
  const letter = optionLetter(o.option);
  const valid = optionIds.includes(letter) ? letter : 'none';
  if (valid !== o.option) {
    // A letter that is not on the table is the commonest way a model invents an option.
    if (valid === 'none' && letter !== '' && letter !== 'NONE') repairs.push(`option "${String(o.option)}" is not on the table`);
    else if (valid === 'none' && letter === '') repairs.push('no option named');
    o.option = valid;
  }
  if (typeof o.say === 'string') {
    const say = o.say.trim();
    const clipped = clip(say, SAY_MAX);
    if (clipped !== say) repairs.push(`statement cut from ${say.length} to ${clipped.length} characters`);
    o.say = clipped;
  } else if (o.say === undefined && o.speak === false) o.say = '';
  if (typeof o.condition !== 'string') {
    if (o.condition !== undefined && o.condition !== null) repairs.push('"condition" was not text');
    o.condition = '';
  } else o.condition = clip(o.condition.trim(), CONDITION_MAX);
  const result = ministerTurnSchema(optionIds).safeParse(o);
  if (!result.success) return { outcome: 'fail', data: null, repairs, errors: issuesOf(result.error) };
  return { outcome: repairs.length ? 'repaired' : 'pass', data: result.data as MinisterTurn, repairs, errors: [] };
}

/**
 * Validates the chair's recommendation. Unlike a minister, the chair may not be given the
 * benefit of the doubt on the option: an option that is not on the table is a failure, and
 * the caller falls back to the ministers' majority.
 */
export function parseChairVerdict(raw: string, optionIds: readonly string[]): Parsed<ChairVerdict> {
  const repairs: string[] = [];
  const found = extractJson(raw);
  if (!found) return { outcome: 'fail', data: null, repairs, errors: ['the reply holds no JSON object'] };
  if (found.wrapped) repairs.push('removed text around the JSON object');
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(found.value)) {
    const key = k === 'condition' ? 'conditions' : k === 'recommendation' || k === 'choice' ? 'option' : k === 'reason' || k === 'rationale' ? 'summary' : k;
    if (key !== k) repairs.push(`renamed "${k}" to "${key}"`);
    if (['option', 'summary', 'dissent', 'conditions'].includes(key)) o[key] = v;
    else repairs.push(`dropped unknown field "${k}"`);
  }
  const letter = optionLetter(o.option);
  if (letter !== o.option && optionIds.includes(letter)) repairs.push(`read option "${String(o.option)}" as ${letter}`);
  o.option = letter;
  if (typeof o.summary === 'string') {
    const summary = o.summary.trim();
    const clipped = clip(summary, SUMMARY_MAX);
    if (clipped !== summary) repairs.push(`summary cut from ${summary.length} to ${clipped.length} characters`);
    o.summary = clipped;
  }
  for (const k of ['dissent', 'conditions'] as const) {
    if (typeof o[k] !== 'string') {
      if (o[k] !== undefined && o[k] !== null) repairs.push(`"${k}" was not text`);
      o[k] = '';
    } else o[k] = clip((o[k] as string).trim(), NOTE_MAX);
  }
  const result = chairVerdictSchema(optionIds).safeParse(o);
  if (!result.success) return { outcome: 'fail', data: null, repairs, errors: issuesOf(result.error) };
  return { outcome: repairs.length ? 'repaired' : 'pass', data: result.data as ChairVerdict, repairs, errors: [] };
}
