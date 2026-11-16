import type { Command, CommandResult } from '../../sim/commands';
import type { Sim } from '../../sim/sim';
import { MONTH_NAMES } from '../../core/constants';
import { dateOf } from '../../sim/state';
import { FACILITIES } from '../../sim/facilities';
import { emptyReport, projectBudget } from '../../sim/economy/budget';
import { ui, type AssistantMessage } from '../../ui/store';
import { checkNumbers } from '../council/grounding';
import type { SchemaOutcome } from '../council/schemas';
import { estimateTokens } from '../council/telemetry';
import { assistantSystem, assistantUser, checkAssistantReply, isDevanagari, offlineReply, type AssistantAction, type AssistantReply, type ChatTurn } from './assistant';
import { manualFor } from './knowledge';
import { cityAlerts, citySituation, type KnownIssue, type Refusal } from './situation';

export interface Completion {
  text: string;
  provider: string;
  /** Token counts and latency as the server measured them, when it did. */
  usage?: { prompt: number; completion: number; reasoning: number };
  latencyMs?: number;
}

/** Asks the language model; returns null when it is unavailable. */
export type Completer = (system: string, user: string, maxTokens: number) => Promise<Completion | null>;

/** The game's server route, which holds the keys and falls back across providers. */
export const httpCompleter: Completer = async (system, user, maxTokens) => {
  try {
    const res = await fetch('/api/llm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system, user, maxTokens, json: true }) });
    const data = (await res.json().catch(() => ({}))) as Partial<Completion>;
    if (!res.ok || typeof data.text !== 'string') return null;
    return { text: data.text, provider: data.provider ?? 'AI', usage: data.usage, latencyMs: data.latencyMs };
  } catch {
    return null;
  }
};

/** One question to the assistant, as the AI inspector lists it. */
export interface AssistantCall {
  id: number;
  question: string;
  /** llm: the model answered. offline: the rule-based answer was used. */
  source: 'llm' | 'offline';
  provider: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  measured: boolean;
  schema: SchemaOutcome | 'n/a';
  repairs: string[];
  /** Manual sections the keyword router put in the prompt. */
  sections: string[];
  /** Figures in the answer found in neither the rules nor the city data. */
  unverified: number[];
  figures: number;
}

export interface AssistantHost {
  sim: Sim;
  issues(): KnownIssue[];
  tool(): string;
  hour(): number;
}

const HISTORY = 6;
const REFUSALS = 6;

/** The budget in one line, for the offline answer. */
function moneyLine(sim: Sim): string {
  const s = sim.state;
  const b = projectBudget(s.buildings, s.roads, s.tax, s.loans, s.stats, emptyReport(), s.policies, s.metro);
  const usd = (n: number): string => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
  return `${usd(s.funds)} in hand, ${usd(b.net)} an hour (income ${usd(b.income)}, spending ${usd(b.expense)}; taxes ${s.tax[1]}% / ${s.tax[2]}% / ${s.tax[3]}%)`;
}

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
  private nextId = 1;
  private nextCall = 1;
  /** Called with each answered question's telemetry. */
  onCall: (call: AssistantCall) => void = () => {};
  /** Pause before retrying a model that did not answer. */
  retryMs = 6000;

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
    this.refusals.unshift({ what, reason: result.reason, when: `${String(Math.floor(d.hour)).padStart(2, '0')}:00, ${MONTH_NAMES[d.month]}` });
    this.refusals.length = Math.min(this.refusals.length, REFUSALS);
  }

  /**
   * The prompt pieces for a question (exposed for the evaluation). Only the manual
   * sections the question touches are sent: see `manualFor`.
   */
  prompt(question: string): { system: string; user: string; sections: string[] } {
    const situation = citySituation(this.host.sim, { refusals: this.refusals, issues: this.host.issues(), tool: this.host.tool(), hour: this.host.hour() });
    const manual = manualFor(question, cityAlerts(this.host.sim).join(' '));
    return { system: assistantSystem(manual.text), user: assistantUser(situation, this.history.slice(-HISTORY), question.trim().slice(0, 600)), sections: manual.sections };
  }

  /** Answers one question. Never throws: without the AI it falls back to the city's warnings. */
  async answer(question: string): Promise<AssistantReply> {
    const { system, user, sections } = this.prompt(question);
    const issues = this.host.issues();
    let reply: AssistantReply | null = null;
    const call: AssistantCall = { id: this.nextCall++, question: question.trim().slice(0, 120), source: 'offline', provider: 'rule-based answer', latencyMs: 0, promptTokens: 0, completionTokens: 0, measured: false, schema: 'n/a', repairs: [], sections, unverified: [], figures: 0 };
    for (let attempt = 0; attempt < 2 && !reply; attempt++) {
      const t0 = Date.now();
      const r = await this.completer(system, user, 900);
      // Free tiers throttle: one pause and a second try when nothing came back at all
      // (which spends no tokens), then the offline answer.
      if (!r) {
        if (attempt > 0) break;
        await new Promise((res) => setTimeout(res, this.retryMs));
        continue;
      }
      const checked = checkAssistantReply(r.text, issues, r.provider);
      call.source = 'llm';
      call.provider = r.provider;
      call.latencyMs = r.latencyMs ?? Date.now() - t0;
      call.promptTokens = r.usage?.prompt ?? estimateTokens(system + user);
      call.completionTokens = r.usage?.completion ?? estimateTokens(r.text);
      call.measured = r.usage !== undefined;
      call.schema = checked.outcome;
      call.repairs = checked.repairs;
      // A reply that cannot be made to fit the contract is not asked for again: that
      // would be a second paid call. The offline answer takes over.
      if (!checked.reply) break;
      reply = checked.reply;
      // The same grounding check the council uses: every figure in the answer must be in
      // the rules or the city data the model was given.
      const numbers = checkNumbers(reply.answer, `${system}\n${user}`, { derive: false });
      call.figures = numbers.checked;
      call.unverified = numbers.ungrounded;
      if (numbers.ungrounded.length) reply.flags = numbers.ungrounded.map((v) => v.toLocaleString('en-US'));
    }
    if (!reply) call.source = call.source === 'llm' ? 'offline' : call.source;
    reply ??= offlineReply(cityAlerts(this.host.sim), issues, isDevanagari(question), question, { money: moneyLine(this.host.sim) });
    this.onCall(call);
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
    const theirs: AssistantMessage = { id: this.nextId++, role: 'assistant', text: reply.answer, actions: reply.actions, source: reply.source, flags: reply.flags };
    ui.assistant.value = { ...ui.assistant.value, busy: false, messages: [...ui.assistant.value.messages, theirs].slice(-30) };
  }

  clear(): void {
    this.history.length = 0;
    ui.assistant.value = { ...ui.assistant.value, messages: [] };
  }
}

export type { AssistantAction };
