import type { Command, CommandResult } from '../../sim/commands';
import type { Sim } from '../../sim/sim';
import { MONTH_NAMES } from '../../core/constants';
import { dateOf } from '../../sim/state';
import { FACILITIES } from '../../sim/facilities';
import { ui, type AssistantMessage } from '../../ui/store';
import { assistantSystem, assistantUser, isDevanagari, offlineReply, parseAssistantReply, type AssistantAction, type AssistantReply, type ChatTurn } from './assistant';
import { gameManual } from './knowledge';
import { cityAlerts, citySituation, type KnownIssue, type Refusal } from './situation';

/** Asks the language model; returns null when it is unavailable. */
export type Completer = (system: string, user: string, maxTokens: number) => Promise<{ text: string; provider: string } | null>;

/** The game's server route, which holds the keys and falls back across providers. */
export const httpCompleter: Completer = async (system, user, maxTokens) => {
  try {
    const res = await fetch('/api/llm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system, user, maxTokens, json: true }) });
    const data = (await res.json().catch(() => ({}))) as { text?: string; provider?: string };
    if (!res.ok || typeof data.text !== 'string') return null;
    return { text: data.text, provider: data.provider ?? 'AI' };
  } catch {
    return null;
  }
};

export interface AssistantHost {
  sim: Sim;
  issues(): KnownIssue[];
  tool(): string;
  hour(): number;
}

const HISTORY = 6;
const REFUSALS = 6;

/** What a refused command was trying to do, in words. */
function describe(cmd: Command): string | null {
  switch (cmd.type) {
    case 'buildRoad':
      return `building ${cmd.road === 1 ? 'an avenue' : 'a street'}`;
    case 'placeFacility':
      return `placing a ${FACILITIES[cmd.kind]?.name ?? 'facility'}`;
    case 'zoneRect':
      return 'zoning';
    case 'bulldozeRoad':
    case 'bulldozeBuilding':
      return 'bulldozing';
    case 'takeLoan':
      return 'taking a loan';
    case 'upgradeRoad':
      return 'upgrading a road';
    default:
      return null;
  }
}

/**
 * Builds the question for the model from the rules, the live city and the conversation,
 * and answers the mayor. Also remembers what the game refused recently, because "why
 * can't I build this?" is the most common question.
 */
export class AssistantController {
  readonly refusals: Refusal[] = [];
  private readonly history: ChatTurn[] = [];
  private readonly manual = gameManual();
  private nextId = 1;

  constructor(
    private readonly host: AssistantHost,
    private readonly completer: Completer = httpCompleter,
  ) {}

  /** Call with every command result; refusals are kept for the assistant to explain. */
  noteCommand(cmd: Command, result: CommandResult): void {
    if (result.ok || !result.reason || result.reason === 'Too short') return;
    const what = describe(cmd);
    if (!what) return;
    const d = dateOf(this.host.sim.state.tick);
    this.refusals.unshift({ what, reason: result.reason, when: `${d.day} ${MONTH_NAMES[d.month]}` });
    this.refusals.length = Math.min(this.refusals.length, REFUSALS);
  }

  /** The prompt pieces for a question (exposed for the evaluation). */
  prompt(question: string): { system: string; user: string } {
    const situation = citySituation(this.host.sim, { refusals: this.refusals, issues: this.host.issues(), tool: this.host.tool(), hour: this.host.hour() });
    return { system: assistantSystem(this.manual), user: assistantUser(situation, this.history.slice(-HISTORY), question.trim().slice(0, 600)) };
  }

  /** Answers one question. Never throws: without the AI it falls back to the city's warnings. */
  async answer(question: string): Promise<AssistantReply> {
    const { system, user } = this.prompt(question);
    const issues = this.host.issues();
    let reply: AssistantReply | null = null;
    for (let attempt = 0; attempt < 2 && !reply; attempt++) {
      const r = await this.completer(system, user, 1200);
      if (!r) break;
      reply = parseAssistantReply(r.text, issues, r.provider);
    }
    reply ??= offlineReply(cityAlerts(this.host.sim), issues, isDevanagari(question));
    this.history.push({ role: 'player', text: question }, { role: 'assistant', text: reply.answer });
    if (this.history.length > HISTORY * 2) this.history.splice(0, this.history.length - HISTORY * 2);
    return reply;
  }

  /** The chat panel's flow: shows the question, then the answer. */
  async ask(question: string): Promise<void> {
    const q = question.trim();
    if (!q || ui.assistant.value.busy) return;
    const mine: AssistantMessage = { id: this.nextId++, role: 'player', text: q };
    ui.assistant.value = { ...ui.assistant.value, busy: true, messages: [...ui.assistant.value.messages, mine] };
    const reply = await this.answer(q);
    const theirs: AssistantMessage = { id: this.nextId++, role: 'assistant', text: reply.answer, actions: reply.actions, source: reply.source };
    ui.assistant.value = { ...ui.assistant.value, busy: false, messages: [...ui.assistant.value.messages, theirs].slice(-30) };
  }

  clear(): void {
    this.history.length = 0;
    ui.assistant.value = { ...ui.assistant.value, messages: [] };
  }
}

export type { AssistantAction };
