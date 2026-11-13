import { parseJsonReply } from '../council/llm';
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
}

export interface ChatTurn {
  role: 'player' | 'assistant';
  text: string;
}

export const OVERLAY_IDS = ['power', 'water', 'traffic', 'pollution', 'crime', 'landValue', 'happiness', 'police', 'fire', 'health', 'education'] as const;

const FACILITY_LIST = Object.entries(FACILITIES)
  .filter(([k]) => Number(k) !== FacilityKind.TownHall)
  .map(([k, f]) => `${k}=${f.name}`)
  .join(', ');

export function assistantSystem(manual: string): string {
  return [
    "You are the mayor's assistant in the city-builder game Metropolis. The player is the mayor. Help them play: explain why something is or is not happening, and what to do next.",
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

export function assistantUser(situation: string, history: readonly ChatTurn[], question: string): string {
  const past = history.length
    ? `EARLIER IN THIS CONVERSATION:\n${history.map((t) => `${t.role === 'player' ? 'Mayor' : 'Assistant'}: ${t.text}`).join('\n')}\n\n`
    : '';
  return `CITY RIGHT NOW:\n${situation}\n\n${past}THE MAYOR ASKS: ${question}`;
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

export function parseAssistantReply(text: string, issues: readonly KnownIssue[], source: string): AssistantReply | null {
  const data = parseJsonReply(text);
  const answer = typeof data?.answer === 'string' ? data.answer.trim() : '';
  if (!answer) return null;
  return { answer, actions: validActions(data!.actions, issues), source };
}

/**
 * Without the AI: the same warnings the HUD shows, and the council's top problem. Honest
 * about being limited.
 */
export function offlineReply(alerts: readonly string[], issues: readonly KnownIssue[], hindi: boolean): AssistantReply {
  const top = [...issues].sort((a, b) => b.severity - a.severity)[0];
  const parts: string[] = [];
  parts.push(hindi ? 'AI अभी उपलब्ध नहीं है, लेकिन शहर के आंकड़ों से यह दिख रहा है:' : 'The AI is not available right now, but here is what the city data shows:');
  if (alerts.length) parts.push(alerts.map((a, i) => `${i + 1}. ${a}.`).join(' '));
  else parts.push(hindi ? 'कोई चेतावनी नहीं है।' : 'There are no warnings.');
  if (top) parts.push(hindi ? `सबसे बड़ी समस्या: ${top.title}. आप Council बुला सकते हैं।` : `Biggest problem: ${top.title}. You can call the council about it.`);
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
