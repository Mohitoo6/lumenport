import { z } from 'zod';
import { extractJson, type SchemaOutcome } from '../council/schemas';
import { FACILITIES, FacilityKind } from '../../sim/facilities';
import type { KnownIssue } from './situation';

/**
 * The mayor's assistant: answers questions about playing the game ("why isn't this
 * building?", "what next?") from the rules and the city's live state, and can offer
 * one-click actions. It never acts on its own; buttons it offers are checked here.
 */

export type AssistantAction =
  | { type: 'council'; issue: string; label: string }
  | { type: 'tool'; tool: 'road' | 'avenue' | 'zone' | 'place' | 'bulldoze'; zone?: 1 | 2 | 3; facility?: number; label: string }
  | { type: 'view'; overlay: string; label: string }
  | { type: 'budget'; label: string };

export interface AssistantReply {
  answer: string;
  actions: AssistantAction[];
  /** Which model answered, or 'offline'. */
  source: string;
  /** Figures in the answer that are in neither the rules nor the city data it was given. */
  flags?: string[];
}

export interface ChatTurn {
  role: 'player' | 'assistant';
  text: string;
}

export const OVERLAY_IDS = ['power', 'water', 'traffic', 'pollution', 'crime', 'landValue', 'happiness', 'police', 'fire', 'health', 'education', 'transit'] as const;

const FACILITY_LIST = Object.entries(FACILITIES)
  .filter(([k]) => Number(k) !== FacilityKind.TownHall)
  .map(([k, f]) => `${k}=${f.name}`)
  .join(', ');

export function assistantSystem(manual: string): string {
  return [
    "You are the mayor's assistant in the city-builder game Lumenport. The player is the mayor. Help them play: explain why something is or is not happening, and what to do next.",
    '',
    'Rules:',
    '- Answer from the GAME RULES and the CITY RIGHT NOW given below. Use the actual figures (money, demand, power, empty zoned land, refusals). Never invent features, buttons, costs or numbers; if the information is not there, say you cannot see it.',
    '- When the player asks why something is not building or failing, find the cause in the city data (refusals, utilities, demand, distance from roads) and say it plainly, then give the fix as concrete steps.',
    '- If one of the listed council problems matches the question, mention that the council can be called about it and offer the council action.',
    '- Be brief: 2 to 6 short sentences, or a few numbered steps. No markdown headings, no tables.',
    '- Reply in the language and script the player used: Hindi in Devanagari if they wrote Devanagari, Hinglish in Latin letters if they wrote Hindi in Latin letters, otherwise English. Keep game terms (Street, Homes, Shops, Industry, Council, Budget) in English.',
    '',
    'You may offer up to 3 buttons the player can click. Only these kinds exist:',
    '- {"type":"council","issue":"<key from the council problem list, in square brackets>","label":"..."}',
    '- {"type":"tool","tool":"road"|"avenue"|"bulldoze","label":"..."}',
    '- {"type":"tool","tool":"zone","zone":1|2|3,"label":"..."}  (1 Homes, 2 Shops, 3 Industry)',
    `- {"type":"tool","tool":"place","facility":<number>,"label":"..."}  (${FACILITY_LIST})`,
    `- {"type":"view","overlay":"${OVERLAY_IDS.join('"|"')}","label":"..."}`,
    '- {"type":"budget","label":"Open the budget"}',
    'Labels are 2 to 5 words, in the same language as your answer.',
    '',
    'Reply with JSON only: {"answer": "<your answer>", "actions": [ ... ]}',
    '',
    manual,
  ].join('\n');
}

export type Script = 'devanagari' | 'hinglish' | 'english';

const HINGLISH = /\b(kya|kyu|kyun|kyon|kaise|kaisa|nahi|nahin|hai|hain|ho|raha|rahe|rahi|karu|karun|karo|karna|kar|mera|meri|mere|paisa|paise|ghar|sadak|bijli|paani|pani|bana|banao|banta|chahiye|abhi|kab|kahan|kidhar|aur|lekin|bhi|yaar)\b/gi;

/** The script the mayor wrote in, so the reply can match it. */
export function scriptOf(text: string): Script {
  if (/[\u0900-\u097F]/.test(text)) return 'devanagari';
  return (text.match(HINGLISH) ?? []).length >= 2 ? 'hinglish' : 'english';
}

const REPLY_IN: Record<Script, string> = {
  devanagari: 'Reply in Hindi written in Devanagari script.',
  hinglish: 'The mayor wrote Hindi in Latin letters (Hinglish). Reply in Hinglish written in Latin letters, like the mayor, NOT in Devanagari. Example style: "Ghar isliye nahi ban rahe kyunki bijli aur paani nahi hai."',
  english: 'Reply in English.',
};

export function assistantUser(situation: string, history: readonly ChatTurn[], question: string): string {
  const past = history.length
    ? `EARLIER IN THIS CONVERSATION:\n${history.map((t) => `${t.role === 'player' ? 'Mayor' : 'Assistant'}: ${t.text}`).join('\n')}\n\n`
    : '';
  return `CITY RIGHT NOW:\n${situation}\n\n${past}THE MAYOR ASKS: ${question}\n\nLANGUAGE: ${REPLY_IN[scriptOf(question)]}`;
}

/** Keeps only actions that exist and point at real things. */
export function validActions(raw: unknown, issues: readonly KnownIssue[]): AssistantAction[] {
  if (!Array.isArray(raw)) return [];
  const out: AssistantAction[] = [];
  for (const a of raw as Array<Record<string, unknown>>) {
    if (!a || typeof a !== 'object') continue;
    const label = typeof a.label === 'string' && a.label.trim() ? a.label.trim().slice(0, 40) : '';
    if (!label) continue;
    if (a.type === 'council' && typeof a.issue === 'string' && issues.some((i) => i.key === a.issue)) out.push({ type: 'council', issue: a.issue, label });
    else if (a.type === 'tool' && (a.tool === 'road' || a.tool === 'avenue' || a.tool === 'bulldoze')) out.push({ type: 'tool', tool: a.tool, label });
    else if (a.type === 'tool' && a.tool === 'zone' && (a.zone === 1 || a.zone === 2 || a.zone === 3)) out.push({ type: 'tool', tool: 'zone', zone: a.zone, label });
    else if (a.type === 'tool' && a.tool === 'place' && typeof a.facility === 'number' && FACILITIES[a.facility] && a.facility !== FacilityKind.TownHall) out.push({ type: 'tool', tool: 'place', facility: a.facility, label });
    else if (a.type === 'view' && typeof a.overlay === 'string' && (OVERLAY_IDS as readonly string[]).includes(a.overlay)) out.push({ type: 'view', overlay: a.overlay, label });
    else if (a.type === 'budget') out.push({ type: 'budget', label });
    if (out.length >= 3) break;
  }
  return out;
}

/** The assistant's reply contract: an answer, and up to three buttons (each checked separately). */
export const ANSWER_MAX = 1400;
export const assistantReplySchema = z.object({ answer: z.string().min(1).max(ANSWER_MAX), actions: z.array(z.unknown()).max(8) }).strict();

export interface ParsedAnswer {
  outcome: SchemaOutcome;
  reply: AssistantReply | null;
  repairs: string[];
  errors: string[];
}

/**
 * Validates the model's reply against the contract, repairing what can be fixed without
 * changing its meaning. Buttons are validated one by one against what exists in the game:
 * an invented button is dropped, not trusted.
 */
export function checkAssistantReply(text: string, issues: readonly KnownIssue[], source: string): ParsedAnswer {
  const repairs: string[] = [];
  const found = extractJson(text);
  if (!found) return { outcome: 'fail', reply: null, repairs, errors: ['the reply holds no JSON object'] };
  if (found.wrapped) repairs.push('removed text around the JSON object');
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(found.value)) {
    const key = k === 'reply' || k === 'response' || k === 'text' ? 'answer' : k === 'buttons' ? 'actions' : k;
    if (key !== k) repairs.push(`renamed "${k}" to "${key}"`);
    if (key === 'answer' || key === 'actions') o[key] = v;
    else repairs.push(`dropped unknown field "${k}"`);
  }
  if (typeof o.answer === 'string') {
    const answer = o.answer.trim();
    if (answer.length > ANSWER_MAX) repairs.push(`answer cut from ${answer.length} to ${ANSWER_MAX} characters`);
    o.answer = answer.slice(0, ANSWER_MAX);
  }
  if (!Array.isArray(o.actions)) {
    if (o.actions !== undefined && o.actions !== null) repairs.push('"actions" was not a list');
    o.actions = [];
  }
  const result = assistantReplySchema.safeParse(o);
  if (!result.success) return { outcome: 'fail', reply: null, repairs, errors: result.error.issues.map((i) => `${i.path.join('.') || 'reply'}: ${i.message}`) };
  const offered = result.data.actions.length;
  const actions = validActions(result.data.actions, issues);
  if (actions.length < Math.min(3, offered)) repairs.push(`dropped ${Math.min(3, offered) - actions.length} button(s) that do not exist in the game`);
  return { outcome: repairs.length ? 'repaired' : 'pass', reply: { answer: result.data.answer, actions, source }, repairs, errors: [] };
}

export function parseAssistantReply(text: string, issues: readonly KnownIssue[], source: string): AssistantReply | null {
  return checkAssistantReply(text, issues, source).reply;
}

/**
 * Without the AI: the same warnings the HUD shows, and the council's top problem. Honest
 * about being limited.
 */
export function offlineReply(alerts: readonly string[], issues: readonly KnownIssue[], hindi: boolean, question = '', facts: { money?: string; goal?: string } = {}): AssistantReply {
  // "What should I do?" is answered by the goal chain, which always knows the next step.
  if (facts.goal && /what (should|do|can) i|what now|next|start|begin|goal|help me|kya kar|क्या कर|आगे/i.test(question)) {
    return {
      answer: hindi ? `AI अभी उपलब्ध नहीं है। अगला लक्ष्य: ${facts.goal}` : `The AI is not available right now, but your next goal is ${facts.goal}`,
      actions: [],
      source: 'offline',
    };
  }
  // Pick what the question is about, so the fallback answers it rather than listing everything.
  const topics: Array<{ ask: RegExp; match: RegExp; money?: boolean }> = [
    { ask: /money|budget|tax|funds|deficit|paisa|paise|पैस|बजट|टैक्स|loan|कर्ज/i, match: /money|tax|budget|loan/i, money: true },
    { ask: /traffic|jam|congest|ट्रैफिक|जाम/i, match: /traffic|gridlock|jam/i },
    { ask: /power|electric|bijli|बिजली/i, match: /power/i },
    { ask: /water|paani|pani|पानी/i, match: /water/i },
    { ask: /clinic|hospital|health|sick|doctor|बीमार|अस्पताल|स्वास्थ्य/i, match: /clinic|health|hospital/i },
    { ask: /school|educat|children|kids|student|padhai|स्कूल|पढ़ाई|शिक्षा/i, match: /school|educat/i },
    { ask: /police|crime|safe|chor|अपराध|पुलिस/i, match: /police|crime/i },
    { ask: /fire|aag|आग/i, match: /fire/i },
    { ask: /pollut|smog|air|dhuan|प्रदूषण|धुआँ/i, match: /pollut|air/i },
    { ask: /job|work|unemploy|naukri|rozgar|नौकरी|रोज़गार/i, match: /job|work/i },
    { ask: /home|house|ghar|घर|grow|build|bana/i, match: /power|water|homes|grow|road/i },
  ];
  const topic = topics.find((t) => t.ask.test(question));
  if (topic?.money && facts.money) {
    return {
      answer: hindi
        ? `AI अभी उपलब्ध नहीं है। शहर का बजट: ${facts.money}. Budget (B) खोलकर टैक्स और खर्च देखें।`
        : `The AI is not available right now. The city's budget: ${facts.money}. Open the Budget (B) to check taxes and spending.`,
      actions: [{ type: 'budget', label: hindi ? 'Budget खोलें' : 'Open the budget' }],
      source: 'offline',
    };
  }
  if (topic) {
    alerts = alerts.filter((a) => topic.match.test(a));
    issues = issues.filter((i) => topic.match.test(i.title));
  }
  const top = [...issues].sort((a, b) => b.severity - a.severity)[0];
  const parts: string[] = [];
  parts.push(hindi ? 'AI अभी उपलब्ध नहीं है, लेकिन शहर के आंकड़ों से यह दिख रहा है:' : 'The AI is not available right now, but here is what the city data shows:');
  if (alerts.length) parts.push(alerts.map((a, i) => `${i + 1}. ${a}.`).join(' '));
  else parts.push(hindi ? 'कोई चेतावनी नहीं है।' : 'There are no warnings.');
  if (!alerts.length && !top && facts.goal) parts.push(hindi ? `अगला लक्ष्य: ${facts.goal}` : `Your next goal is ${facts.goal}`);
  if (top) {
    const why = top.summary ? ` ${top.summary}` : '';
    parts.push(hindi ? `सबसे बड़ी समस्या: ${top.title}.${why} आप Council बुला सकते हैं।` : `${topic ? 'The problem' : 'Biggest problem'}: ${top.title}.${why} The council can weigh the options for you.`);
  }
  return {
    answer: parts.join(' '),
    actions: top ? [{ type: 'council', issue: top.key, label: hindi ? 'Council बुलाएँ' : 'Call the council' }] : [],
    source: 'offline',
  };
}

/** Whether a question is written in Devanagari. */
export function isDevanagari(text: string): boolean {
  return /[ऀ-ॿ]/.test(text);
}
