import { Rng } from '../../core/rng';
import type { Sim } from '../../sim/sim';
import type { Speed } from '../../sim/state';
import { ui, type CouncilMessage, type CouncilView, type SeatState } from '../../ui/store';
import { attendees, briefing, type Seat } from './briefs';
import { detectIssues, type CityIssue } from './issues';
import { DemoTransport, HttpTransport, aiStatus, type Transport } from './llm';
import { MINISTERS, type MinistryId } from './ministries';
import { optionsFor, type CouncilOption } from './options';
import type { Lang } from './prompts';
import { CouncilSession, type SessionEvent } from './session';
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
}

/**
 * Watches the city for problems, lets residents talk about them, has the responsible
 * minister ask the mayor for a meeting, and runs the meeting itself.
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
  private current: { issue: CityIssue; options: CouncilOption[]; seats: Seat[] } | null = null;
  private resumeSpeed: Speed | null = null;
  private queue: Queued[] = [];
  private playing: { item: Queued; left: number } | null = null;
  private gap = 0;
  private track = new Map<Who, Track>();
  private backers = new Map<MinistryId, string>();

  constructor(private readonly host: CouncilHost) {}

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

  /** Opens the council chamber on an issue: the brief, before anyone speaks. */
  convene(issueKey: string): void {
    const issue = this.issues.find((i) => i.key === issueKey) ?? detectIssues(this.host.sim).find((i) => i.key === issueKey);
    if (!issue) return;
    ui.request.value = null;
    ui.showIssues.value = false;
    const sim = this.host.sim;
    const options = optionsFor(sim, issue);
    const seats = attendees(sim, issue, options);
    this.current = { issue, options, seats };
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
      options: options.map((o) => ({ id: o.id, title: o.title, cost: o.cost, monthly: o.monthly, facts: o.facts, backers: [], hasActions: o.actions.length > 0, x: o.x, z: o.z })),
      seats: seats.map((s) => ({ id: s.id, state: 'waiting', reason: s.reason })),
      chief: 'waiting',
      messages: [],
      round: 0,
      source: this.forceDemo ? 'Demo (no AI)' : 'AI',
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

  /** Starts the debate. `demo` uses scripted ministers instead of the AI. */
  start(note: string, lang: Lang, demo: boolean): void {
    const cur = this.current;
    if (!cur || this.session) return;
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      // Not remembered; fine.
    }
    const transport: Transport = demo || this.forceDemo ? new DemoTransport() : new HttpTransport();
    const sim = this.host.sim;
    const briefings = Object.fromEntries(MINISTERS.map((m) => [m.id, briefing(sim, m.id)])) as Record<MinistryId, string[]>;
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
      speaking: undefined,
      options: v.options.map((o) => ({ ...o, backers: [] })),
    }));
    const onEvent = (e: SessionEvent): void => {
      if (ui.council.value?.issue.key !== cur.issue.key) return;
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
          this.queue.push({
            msg: { key: `${st.minister}-${st.round}`, who: st.minister, round: st.round, stance: st.stance, option: st.option, text: st.text, condition: st.condition, provider: e.provider },
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
        case 'failed': {
          const t = this.trackOf(e.who);
          t.inFlight = false;
          t.failed = true;
          this.refresh(e.who);
          break;
        }
        case 'decision': {
          const t = this.trackOf('chief');
          t.inFlight = false;
          t.queued++;
          this.queue.push({
            msg: { key: 'chief', who: 'chief', round: 3, option: e.decision.option, text: e.decision.summary, provider: e.provider },
            decision: { option: e.decision.option, summary: e.decision.summary, dissent: e.decision.dissent, conditions: e.decision.conditions },
          });
          this.refresh('chief');
          break;
        }
        case 'error':
          this.queue.push({ error: e.message });
          break;
        case 'done':
          this.session = null;
          break;
      }
    };
    this.session = new CouncilSession({ city: this.host.cityName(), issue: cur.issue, options: cur.options, seats: cur.seats, briefings, mayorNote: note.trim().slice(0, 400), lang }, transport, onEvent);
    void this.session.run();
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

  /** Carries out an option: every action through the normal game commands. */
  approve(optionId: string): void {
    const cur = this.current;
    const option = cur?.options.find((o) => o.id === optionId);
    if (!cur || !option) return;
    const sim = this.host.sim;
    let spent = 0;
    for (const action of option.actions) {
      const r = sim.apply(action);
      if (!r.ok) {
        this.patch(() => ({ phase: 'enacted', result: { ok: false, text: `Could not carry out option ${option.id}: ${r.reason ?? 'refused'}. The city may have changed since the meeting.` } }));
        return;
      }
      spent += r.cost ?? 0;
    }
    this.snoozed.set(cur.issue.key, Date.now() + RESOLVED_MS);
    const text = option.actions.length === 0 ? 'No action taken. The council will look at this again if it gets worse.' : `Option ${option.id} approved: ${option.title}.${spent > 0 ? ` ${'$' + spent.toLocaleString('en-US')} spent.` : ''}`;
    this.patch(() => ({ phase: 'enacted', result: { ok: true, text } }));
    if (option.x !== undefined && option.z !== undefined) this.host.lookAt(option.x, option.z);
  }

  close(): void {
    this.session?.cancel();
    this.session = null;
    this.resetPlayback();
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
