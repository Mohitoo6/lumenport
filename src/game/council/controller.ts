import { Rng } from '../../core/rng';
import type { Sim } from '../../sim/sim';
import type { Speed } from '../../sim/state';
import { ui, type CouncilView, type SeatState } from '../../ui/store';
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

  constructor(private readonly host: CouncilHost) {}

  update(dt: number): void {
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
    if (issue.x || issue.z) this.host.lookAt(issue.x, issue.z);
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

  private seat(who: MinistryId | 'chief', state: SeatState): void {
    if (who === 'chief') this.patch(() => ({ chief: state }));
    else this.patch((v) => ({ seats: v.seats.map((s) => (s.id === who ? { ...s, state } : s)) }));
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
      options: v.options.map((o) => ({ ...o, backers: [] })),
    }));
    const backers = new Map<MinistryId, string>();
    // Ministers who spoke in round 1 and have nothing to add in round 2 still "have spoken".
    const spoke = new Set<MinistryId>();
    const onEvent = (e: SessionEvent): void => {
      if (ui.council.value?.issue.key !== cur.issue.key) return;
      switch (e.type) {
        case 'round':
          this.patch(() => ({ round: e.round }));
          break;
        case 'thinking':
          this.seat(e.who, 'thinking');
          break;
        case 'said': {
          const st = e.statement;
          if (st.option !== 'none') backers.set(st.minister, st.option);
          spoke.add(st.minister);
          this.seat(st.minister, 'spoke');
          this.patch((v) => ({
            messages: [...v.messages, { key: `${st.minister}-${st.round}`, who: st.minister, round: st.round, stance: st.stance, option: st.option, text: st.text, condition: st.condition, provider: e.provider }],
            options: v.options.map((o) => ({ ...o, backers: [...backers].filter(([, opt]) => opt === o.id).map(([m]) => m) })),
          }));
          break;
        }
        case 'silent':
          this.seat(e.who, spoke.has(e.who) ? 'spoke' : 'silent');
          break;
        case 'failed':
          this.seat(e.who, 'failed');
          break;
        case 'decision':
          this.seat('chief', 'spoke');
          this.patch((v) => ({
            phase: 'decided',
            decision: { option: e.decision.option, summary: e.decision.summary, dissent: e.decision.dissent, conditions: e.decision.conditions },
            messages: [...v.messages, { key: 'chief', who: 'chief', round: 3, option: e.decision.option, text: e.decision.summary, provider: e.provider }],
          }));
          this.host.chime('decision');
          break;
        case 'error':
          this.patch(() => ({ phase: 'error', error: e.message }));
          break;
        case 'done':
          this.session = null;
          break;
      }
    };
    this.session = new CouncilSession({ city: this.host.cityName(), issue: cur.issue, options: cur.options, seats: cur.seats, briefings, mayorNote: note.trim().slice(0, 400), lang }, transport, onEvent);
    void this.session.run();
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
    this.current = null;
    ui.council.value = null;
    if (this.resumeSpeed !== null) {
      this.host.setSpeed(this.resumeSpeed === 0 ? 1 : this.resumeSpeed);
      this.resumeSpeed = null;
    }
  }

  /** For tests: whether a meeting is in progress. */
  get busy(): boolean {
    return this.session !== null;
  }
}
