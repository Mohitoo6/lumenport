import { MONTH_NAMES } from '../../core/constants';
import { Rng } from '../../core/rng';
import type { Command } from '../../sim/commands';
import type { Sim } from '../../sim/sim';
import { dateOf, type Speed } from '../../sim/state';
import { ui, type CouncilMessage, type CouncilView, type SeatState } from '../../ui/store';
import { execute, financing } from './effects';
import { GraphState } from './graph';
import { detectIssues, type CityIssue } from './issues';
import { CachedTransport, DemoTransport, HttpTransport, aiStatus, type Transport } from './llm';
import { EpisodicMemory, decisionRecord } from './memory';
import type { MinistryId } from './ministries';
import type { Lang } from './prompts';
import { CouncilSession, prepareMeeting, type Meeting, type SessionEvent } from './session';
import { browserKV, type KV } from './storage';
import { Recorder, addToStats, loadStats, loadTraces, saveStats, saveTrace, type Attribution } from './telemetry';
import { makePost, requestText } from './voices';

const CHECK_EVERY = 2;
/** A minister asks for a meeting only once a problem has lasted this many checks. */
const PERSIST_CHECKS = 3;
const REQUEST_SEVERITY = 0.5;
const SNOOZE_MS = 3 * 60_000;
const RESOLVED_MS = 5 * 60_000;
const LANG_KEY = 'metropolis.councilLang';
/** Pause between one speaker finishing and the next starting. */
const GAP = 0.6;

/** How long a statement takes to deliver: roughly reading speed, within limits. */
export function speechSeconds(text: string): number {
  return Math.max(4, Math.min(16, text.length / 15));
}

type Who = MinistryId | 'chief';

/** Something the session produced, waiting its turn to be shown and spoken. */
interface Queued {
  msg?: CouncilMessage;
  backer?: [MinistryId, string];
  decision?: NonNullable<CouncilView['decision']>;
  error?: string;
}

interface Track {
  inFlight: boolean;
  queued: number;
  revealed: boolean;
  silent: boolean;
  failed: boolean;
}

export interface CouncilHost {
  sim: Sim;
  cityName(): string;
  lookAt(x: number, z: number): void;
  /** The game's current speed, and a way to change it (the council pauses the city). */
  speed(): Speed;
  setSpeed(s: Speed): void;
  /** Plays a short sound for council moments. */
  chime(kind: 'request' | 'decision'): void;
  /** Where memory, cache and telemetry persist. Defaults to the browser's local storage. */
  kv?: KV;
}

/** One meeting in progress: what was computed for it, and where it is in the graph. */
interface Current {
  meeting: Meeting;
  graph: GraphState;
  recorder: Recorder;
  memory: { chair: string[]; byMinister: Partial<Record<MinistryId, string[]>> };
  /** The first minister to back each option, for attribution. */
  firstBacker: Map<string, MinistryId>;
  recommended?: string;
}

/**
 * The council's orchestrator. It owns the two ends of the pipeline that are not the
 * model's business: detecting triggers in the simulation and handing a recommendation to
 * the mayor, then executing what the mayor approves. The debate in between is
 * `CouncilSession`; the stages and the moves between them are `graph.ts`.
 */
export class CouncilController {
  issues: CityIssue[] = [];
  /** Whether problems raise requests and residents post on their own. */
  auto = true;
  /** Forces the offline demo council (screenshot runs). */
  forceDemo = false;

  private checkTimer = 0;
  private postTimer = 8;
  private readonly seen = new Map<string, number>();
  private readonly snoozed = new Map<string, number>();
  private readonly rng = new Rng(0x5eed);
  private session: CouncilSession | null = null;
  private current: Current | null = null;
  private readonly kv: KV;
  private memory: EpisodicMemory | null = null;
  private memoryCity = '';
  private resumeSpeed: Speed | null = null;
  private queue: Queued[] = [];
  private playing: { item: Queued; left: number } | null = null;
  private gap = 0;
  private track = new Map<Who, Track>();
  private backers = new Map<MinistryId, string>();

  constructor(private readonly host: CouncilHost) {
    this.kv = host.kv ?? browserKV();
    ui.aiStats.value = loadStats(this.kv);
    ui.traces.value = loadTraces(this.kv);
    ui.trace.value = ui.traces.value[0] ?? null;
  }

  /** This city's decision memory. A different city (another seed) has its own. */
  private memoryFor(sim: Sim, today: number): EpisodicMemory {
    const city = String(sim.state.seed);
    if (!this.memory || this.memoryCity !== city) {
      this.memory = new EpisodicMemory(this.kv, city);
      this.memoryCity = city;
    }
    // A loaded older save, or a new city on the same seed, has not made those decisions.
    this.memory.rewindTo(today);
    return this.memory;
  }

  private when(): { day: number; date: string } {
    const d = dateOf(this.host.sim.state.tick);
    return { day: d.totalDays, date: `${d.day} ${MONTH_NAMES[d.month]} ${d.year}` };
  }

  update(dt: number): void {
    this.play(dt);
    this.checkTimer += dt;
    if (this.checkTimer >= CHECK_EVERY) {
      this.checkTimer = 0;
      this.check();
    }
    if (this.auto && !ui.council.value) {
      this.postTimer -= dt;
      if (this.postTimer <= 0) {
        this.postTimer = 14 + this.rng.next() * 16;
        this.post();
      }
    }
  }

  private check(): void {
    this.issues = detectIssues(this.host.sim);
    ui.issues.value = this.issues.map((i) => ({ key: i.key, title: i.title, lead: i.lead, severity: i.severity }));
    const live = new Set(this.issues.map((i) => i.key));
    for (const k of [...this.seen.keys()]) if (!live.has(k)) this.seen.delete(k);
    for (const i of this.issues) this.seen.set(i.key, (this.seen.get(i.key) ?? 0) + 1);
    // A request whose problem has gone away is withdrawn.
    const req = ui.request.value;
    if (req && !live.has(req.issueKey)) ui.request.value = null;
    if (!this.auto || ui.council.value || ui.request.value) return;
    const now = Date.now();
    const due = this.issues.find((i) => i.severity >= REQUEST_SEVERITY && (this.seen.get(i.key) ?? 0) >= PERSIST_CHECKS && (this.snoozed.get(i.key) ?? 0) < now);
    if (due) {
      ui.request.value = { issueKey: due.key, minister: due.lead, title: due.title, text: requestText(due), severity: due.severity };
      this.host.chime('request');
    }
  }

  private post(): void {
    const top = this.issues.filter((i) => i.severity > 0.3);
    const issue = top.length && this.rng.next() < 0.85 ? top[Math.floor(this.rng.next() * Math.min(3, top.length))]! : null;
    if (!issue && this.host.sim.state.stats.population < 50) return;
    const post = makePost(issue, this.rng.next(), this.rng.next());
    ui.posts.value = [post, ...ui.posts.value].slice(0, 3);
    // Posts fade after a while.
    setTimeout(() => (ui.posts.value = ui.posts.value.filter((p) => p.id !== post.id)), 26_000);
  }

  dismissRequest(): void {
    const req = ui.request.value;
    if (req) this.snoozed.set(req.issueKey, Date.now() + SNOOZE_MS);
    ui.request.value = null;
  }

  /**
   * Opens the council chamber on an issue: the brief, before anyone speaks. Everything
   * here is code: the options and their measured effects, the triage that decides who is
   * seated, the money limits and the memory to recall. No model has been called yet.
   */
  convene(issueKey: string): void {
    const issue = this.issues.find((i) => i.key === issueKey) ?? detectIssues(this.host.sim).find((i) => i.key === issueKey);
    if (!issue) return;
    const requested = ui.request.value?.issueKey === issueKey;
    ui.request.value = null;
    ui.showIssues.value = false;
    const sim = this.host.sim;
    const meeting = prepareMeeting(sim, issue);
    const { options, seats, limits } = meeting;
    const when = this.when();
    const store = this.memoryFor(sim, when.day);
    const moneyAtStake = options.some((o) => o.cost > 0);
    const chair = store.recall(issue, when.day, { moneyAtStake, limit: 3 }).map((r) => r.line);
    const byMinister: Partial<Record<MinistryId, string[]>> = {};
    for (const seat of seats) {
      const lines = store.recall(issue, when.day, { moneyAtStake, limit: 2, ministry: seat.id }).map((r) => r.line);
      if (lines.length) byMinister[seat.id] = lines;
    }
    const mode = this.forceDemo ? 'offline' : 'live';
    const recorder = new Recorder(
      {
        mode,
        issue: { key: issue.key, kind: issue.kind, title: issue.title, severity: issue.severity, lead: issue.lead },
        day: when.day,
        trigger: `${issue.title}: severity ${Math.round(issue.severity * 100)}%, seen in ${this.seen.get(issue.key) ?? 1} consecutive checks; ${requested ? 'the lead minister asked for a meeting' : 'the mayor called the council'}`,
        triage: meeting.triage,
        limits,
        options: options.map((o) => ({ id: o.id, title: o.title, effects: o.effects, feasibility: o.feasibility })),
        memory: chair,
      },
      (trace) => (ui.trace.value = trace),
    );
    const graph = new GraphState();
    graph.go('triage', recorder.trace.trigger);
    recorder.graph(graph.node, graph.history);
    this.current = { meeting, graph, recorder, memory: { chair, byMinister }, firstBacker: new Map() };
    if (this.resumeSpeed === null) {
      this.resumeSpeed = this.host.speed();
      this.host.setSpeed(0);
    }
    let lang: Lang = 'en';
    try {
      if (localStorage.getItem(LANG_KEY) === 'hi') lang = 'hi';
    } catch {
      // Remembering the language is a convenience only.
    }
    ui.council.value = {
      phase: 'brief',
      issue: { key: issue.key, title: issue.title, summary: issue.summary, facts: issue.facts, lead: issue.lead, severity: issue.severity, x: issue.x, z: issue.z },
      options: options.map((o) => {
        const loan = o.feasibility.status === 'needs_loan' ? financing(sim, o.feasibility.shortfall) : null;
        return { id: o.id, title: o.title, gist: o.gist, cost: o.cost, monthly: o.monthly, facts: o.facts, effects: o.effects, feasibility: o.feasibility, financing: loan ? { amount: loan.amount } : undefined, backers: [], hasActions: o.actions.length > 0, x: o.x, z: o.z };
      }),
      seats: seats.map((s) => ({ id: s.id, state: 'waiting', reason: s.reason })),
      chief: 'waiting',
      messages: [],
      round: 0,
      source: this.forceDemo ? 'Offline (no AI)' : 'AI',
      triage: meeting.triage,
      limits,
      memory: chair,
      aiReady: true,
      providers: [],
      lang,
    };
    if (!this.forceDemo) {
      void aiStatus().then((s) => {
        const v = ui.council.value;
        if (v && v.issue.key === issue.key) ui.council.value = { ...v, aiReady: s.ready, providers: s.providers };
      });
    }
  }

  private patch(f: (v: CouncilView) => Partial<CouncilView>): void {
    const v = ui.council.value;
    if (v) ui.council.value = { ...v, ...f(v) };
  }

  private trackOf(who: Who): Track {
    let t = this.track.get(who);
    if (!t) {
      t = { inFlight: false, queued: 0, revealed: false, silent: false, failed: false };
      this.track.set(who, t);
    }
    return t;
  }

  /** Recomputes one seat's state from what is known and what has been shown. */
  private refresh(who: Who): void {
    const t = this.trackOf(who);
    const v = ui.council.value;
    const state: SeatState =
      v?.speaking?.who === who ? 'speaking' : t.failed ? 'failed' : t.inFlight || t.queued > 0 ? 'thinking' : t.revealed ? 'spoke' : t.silent ? 'silent' : 'waiting';
    if (who === 'chief') this.patch(() => ({ chief: state }));
    else this.patch((x) => ({ seats: x.seats.map((s) => (s.id === who ? { ...s, state } : s)) }));
  }

  /** Starts the debate. `demo` runs it offline: deterministic agents, no model, no tokens. */
  start(note: string, lang: Lang, demo: boolean): void {
    const cur = this.current;
    if (!cur || this.session) return;
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      // Not remembered; fine.
    }
    const offline = demo || this.forceDemo;
    // Live calls go through the exact-match cache: asking the same thing about the same
    // city twice (a meeting resumed after a rate limit) costs nothing the second time.
    const transport: Transport = offline ? new DemoTransport() : new CachedTransport(new HttpTransport(), this.kv);
    const { meeting } = cur;
    // A meeting that is run again starts a fresh walk through the graph.
    if (cur.graph.node !== 'triage') {
      cur.graph = new GraphState();
      cur.graph.go('triage', 'the mayor sent the council back to debate');
    }
    cur.recorder.restart(offline ? 'offline' : 'live');
    cur.recorder.graph(cur.graph.node, cur.graph.history);
    cur.firstBacker.clear();
    cur.recommended = undefined;
    this.resetPlayback();
    this.patch((v) => ({
      phase: 'debate',
      lang,
      source: transport.label,
      round: 1,
      messages: [],
      seats: v.seats.map((s) => ({ ...s, state: 'waiting' as SeatState })),
      chief: 'waiting',
      decision: undefined,
      error: undefined,
      result: undefined,
      notice: undefined,
      speaking: undefined,
      options: v.options.map((o) => ({ ...o, backers: [] })),
    }));
    const onEvent = (e: SessionEvent): void => {
      if (this.current !== cur || ui.council.value?.issue.key !== meeting.issue.key) return;
      switch (e.type) {
        case 'round':
          if (!this.playing && this.queue.length === 0) this.patch(() => ({ round: e.round }));
          break;
        case 'thinking':
          this.trackOf(e.who).inFlight = true;
          this.refresh(e.who);
          break;
        case 'said': {
          const st = e.statement;
          const t = this.trackOf(st.minister);
          t.inFlight = false;
          t.queued++;
          if (st.option !== 'none' && !cur.firstBacker.has(st.option)) cur.firstBacker.set(st.option, st.minister);
          this.queue.push({
            msg: { key: `${st.minister}-${st.round}`, who: st.minister, round: st.round, stance: st.stance, option: st.option, text: st.text, condition: st.condition, provider: e.provider, standIn: st.standIn, flags: st.flags },
            backer: st.option !== 'none' ? [st.minister, st.option] : undefined,
          });
          this.refresh(st.minister);
          break;
        }
        case 'silent': {
          const t = this.trackOf(e.who);
          t.inFlight = false;
          t.silent = true;
          this.refresh(e.who);
          break;
        }
        case 'failed':
          // The stand-in for this seat speaks next; the seat is not lost.
          break;
        case 'notice':
          this.patch(() => ({ notice: e.message }));
          break;
        case 'decision': {
          const t = this.trackOf('chief');
          t.inFlight = false;
          t.queued++;
          cur.recommended = e.decision.option;
          const d = e.decision;
          this.queue.push({
            msg: { key: 'chief', who: 'chief', round: 3, option: d.option, text: d.summary, provider: e.provider, standIn: d.source === 'policy' && !offline },
            decision: { option: d.option, summary: d.summary, dissent: d.dissent, conditions: d.conditions, guardrail: d.guardrail, source: d.source },
          });
          this.refresh('chief');
          break;
        }
        case 'error':
          this.queue.push({ error: e.message });
          break;
        case 'done':
          this.session = null;
          this.persist(cur, true);
          break;
      }
    };
    this.session = new CouncilSession(
      { city: this.host.cityName(), issue: meeting.issue, options: meeting.options, seats: meeting.seats, briefings: meeting.briefings, limits: meeting.limits, mayorNote: note.trim().slice(0, 400), lang, memory: cur.memory },
      transport,
      onEvent,
      { graph: cur.graph, recorder: cur.recorder },
    );
    void this.session.run();
  }

  /** Saves the meeting's trace; `finished` also folds it into the lifetime numbers. */
  private persist(cur: Current, finished: boolean): void {
    ui.traces.value = saveTrace(this.kv, cur.recorder.trace);
    if (finished) {
      ui.aiStats.value = addToStats(ui.aiStats.value, cur.recorder.trace);
      saveStats(this.kv, ui.aiStats.value);
    }
  }

  private resetPlayback(): void {
    this.queue = [];
    this.playing = null;
    this.gap = 0;
    this.track.clear();
    this.backers.clear();
  }

  /** Shows queued statements one at a time, each for as long as it takes to say. */
  private play(dt: number): void {
    if (!ui.council.value) return;
    if (this.playing) {
      this.playing.left -= dt;
      if (this.playing.left > 0) return;
      const done = this.playing.item;
      this.playing = null;
      this.conclude(done);
      this.gap = GAP;
    }
    if (this.gap > 0) {
      this.gap -= dt;
      return;
    }
    const next = this.queue.shift();
    if (!next) return;
    const seconds = this.reveal(next);
    if (seconds > 0) this.playing = { item: next, left: seconds };
    else this.conclude(next);
  }

  /** Puts one item on screen. Returns how long it should hold the floor. */
  private reveal(item: Queued): number {
    if (item.error) {
      this.patch(() => ({ phase: 'error', error: item.error, speaking: undefined }));
      return 0;
    }
    const m = item.msg;
    if (!m) return 0;
    if (item.backer) this.backers.set(item.backer[0], item.backer[1]);
    const t = this.trackOf(m.who);
    t.queued = Math.max(0, t.queued - 1);
    t.revealed = true;
    const seconds = speechSeconds(m.text);
    this.patch((v) => ({
      round: Math.max(v.round, Math.min(2, m.round)),
      messages: [...v.messages, m],
      speaking: { key: m.key, who: m.who, seconds },
      options: v.options.map((o) => ({ ...o, backers: [...this.backers].filter(([, opt]) => opt === o.id).map(([id]) => id) })),
    }));
    this.refresh(m.who);
    return seconds;
  }

  /** After an item has been spoken. */
  private conclude(item: Queued): void {
    const who = item.msg?.who;
    if (ui.council.value?.speaking && ui.council.value.speaking.key === item.msg?.key) this.patch(() => ({ speaking: undefined }));
    if (who) this.refresh(who);
    if (item.decision) {
      this.patch(() => ({ phase: 'decided', decision: item.decision }));
      this.host.chime('decision');
    }
  }

  /** Shows everything already said at once (the mayor's fast-forward). */
  skip(): void {
    if (this.playing) {
      const item = this.playing.item;
      this.playing = null;
      this.conclude(item);
    }
    while (this.queue.length) {
      const item = this.queue.shift()!;
      this.reveal(item);
      this.conclude(item);
    }
    this.gap = 0;
  }

  /**
   * The human-in-the-loop step: the mayor approves an option (the council's, or their
   * own). It runs as one transaction: checked on a fork of the city first, committed only
   * if every command passes, then measured and compared with the payload on the card.
   * `withLoan` first takes the loan that covers an option the treasury cannot pay for.
   */
  approve(optionId: string, withLoan = false): void {
    const cur = this.current;
    const option = cur?.meeting.options.find((o) => o.id === optionId);
    if (!cur || !option || !cur.graph.can('execute')) return;
    const sim = this.host.sim;
    const { issue, seats } = cur.meeting;
    const recommended = cur.recommended ?? '';
    const followedChair = option.id === recommended;
    cur.graph.go('execute', `the mayor approved option ${option.id}${recommended ? (followedChair ? ', as recommended' : `, overruling the recommendation (${recommended})`) : ''}`);
    cur.recorder.graph(cur.graph.node, cur.graph.history);
    let actions: Command[] = option.actions;
    if (withLoan && option.feasibility.status === 'needs_loan') {
      const loan = financing(sim, option.feasibility.shortfall);
      if (loan) actions = [...loan.tiers.map((tier) => ({ type: 'takeLoan', tier }) as Command), ...option.actions];
    }
    const report = execute(sim, actions);
    cur.recorder.set({ execution: report });
    if (!report.ok) {
      cur.graph.go('hitl', `execution refused at ${report.stage}: ${report.reason ?? 'refused'}`);
      cur.recorder.graph(cur.graph.node, cur.graph.history);
      const why = report.stage === 'preflight' ? 'Nothing was changed.' : 'The city may be partly changed: check it.';
      this.patch(() => ({ result: { ok: false, text: `Could not carry out option ${option.id}: ${report.reason ?? 'refused'}. ${why}` } }));
      return;
    }
    const backers = [...this.backers].filter(([, o]) => o === option.id).map(([m]) => m);
    const attribution: Attribution = { chosen: option.id, recommended, followedChair, proposedBy: cur.firstBacker.get(option.id) ?? null, backers };
    const observed = report.observed ?? option.effects;
    this.memoryFor(sim, this.when().day).record(decisionRecord(this.when(), issue, seats.map((s) => s.id), { title: option.title, acted: actions.length > 0 }, observed, followedChair));
    cur.recorder.set({ attribution });
    cur.graph.go('done', report.drift.length ? `executed with ${report.drift.length} field(s) off the projection` : 'executed; the city changed exactly as projected');
    cur.recorder.graph(cur.graph.node, cur.graph.history);
    ui.aiStats.value = { ...ui.aiStats.value, decisions: ui.aiStats.value.decisions + 1, followedChair: ui.aiStats.value.followedChair + (followedChair ? 1 : 0) };
    saveStats(this.kv, ui.aiStats.value);
    this.persist(cur, false);
    this.snoozed.set(issue.key, Date.now() + RESOLVED_MS);
    const spent = report.spent;
    const text = actions.length === 0 ? 'No action taken. The council will look at this again if it gets worse.' : `Option ${option.id} approved: ${option.title}.${spent > 0 ? ` ${'$' + spent.toLocaleString('en-US')} spent.` : ''}`;
    this.patch(() => ({ phase: 'enacted', result: { ok: true, text, observed, drift: report.drift } }));
    if (option.x !== undefined && option.z !== undefined) this.host.lookAt(option.x, option.z);
  }

  close(): void {
    this.session?.cancel();
    this.session = null;
    this.resetPlayback();
    const cur = this.current;
    if (cur) {
      // Leaving after the recommendation is a decision to defer; leaving earlier abandons the meeting.
      const moved = cur.graph.node === 'hitl' ? cur.graph.tryGo('done', 'the mayor deferred the decision') : cur.graph.tryGo('aborted', 'the mayor left the meeting');
      if (moved) {
        cur.recorder.graph(cur.graph.node, cur.graph.history);
        this.persist(cur, false);
      }
    }
    this.current = null;
    ui.council.value = null;
    if (this.resumeSpeed !== null) {
      this.host.setSpeed(this.resumeSpeed === 0 ? 1 : this.resumeSpeed);
      this.resumeSpeed = null;
    }
  }

  /** Whether the ministers are still being consulted (playback may run on after). */
  get consulting(): boolean {
    return this.session !== null;
  }

  /** For tests: whether a meeting is in progress. */
  get busy(): boolean {
    return this.session !== null || this.playing !== null || this.queue.length > 0;
  }
}
