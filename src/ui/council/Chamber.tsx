import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { parseInstruction } from '../../game/council/constraints';
import type { StateDelta } from '../../game/council/effects';
import { CHIEF_SECRETARY, MINISTER_BY_ID, MINISTERS, type MinistryId } from '../../game/council/ministries';
import type { Lang, Stance } from '../../game/council/prompts';
import { actions, ui, type CouncilMessage, type CouncilOptionView, type CouncilView, type SeatState } from '../store';
import { Inspector } from './Inspector';
import { LivePortrait, Portrait } from './Portrait';
import './council.css';
import './chamber.css';

/**
 * The council chamber's interface.
 *
 * The room is the stage, so the interface keeps to its edges. Along the bottom runs the
 * division board: one column per option, with each minister's nameplate dropping into the
 * column they back, so the state of the debate reads at a glance. Above it, one thing at a
 * time: the briefing sheet before the meeting, the speaker's caption during it, the
 * Chief Secretary's ruling after it. The full transcript ("Minutes") and the AI inspector
 * open on the right only when asked for.
 */

const usd = (n: number): string => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const signed = (n: number): string => `${n < 0 ? '−' : '+'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

interface Chip {
  text: string;
  tone: 'good' | 'bad' | 'plain';
}

/** What an option does besides money, from its measured payload. */
function effectChips(e: StateDelta): Chip[] {
  const out: Chip[] = [];
  if (e.taxRateDelta.some((d) => d !== 0)) out.push({ text: `Tax ${e.taxRateDelta.map((d) => (d > 0 ? `+${d}` : String(d))).join('/')} pts`, tone: 'bad' });
  if (e.debtDelta > 0) out.push({ text: `Debt +${usd(e.debtDelta)}`, tone: 'bad' });
  if (e.residentsDisplaced > 0) out.push({ text: `${e.residentsDisplaced} residents displaced`, tone: 'bad' });
  if (e.jobsLost > 0) out.push({ text: `${e.jobsLost} jobs lost`, tone: 'bad' });
  if (e.powerSupplyDelta !== 0) out.push({ text: `Power ${e.powerSupplyDelta > 0 ? '+' : '−'}${Math.abs(e.powerSupplyDelta)} MW`, tone: e.powerSupplyDelta > 0 ? 'good' : 'bad' });
  if (e.waterSupplyDelta !== 0) out.push({ text: `Water ${e.waterSupplyDelta > 0 ? '+' : '−'}${Math.abs(e.waterSupplyDelta).toLocaleString('en-US')}`, tone: e.waterSupplyDelta > 0 ? 'good' : 'bad' });
  if (e.trafficImpact.rushPeakFactor !== 1) out.push({ text: `Rush peak ${Math.round(e.trafficImpact.rushPeakFactor * 100)}%`, tone: e.trafficImpact.rushPeakFactor < 1 ? 'good' : 'bad' });
  if (e.trafficImpact.transitRidersDelta > 0) out.push({ text: `${e.trafficImpact.transitRidersDelta} leave the car`, tone: 'good' });
  if (e.trafficImpact.capacityDelta !== 0) out.push({ text: `Road capacity ${e.trafficImpact.capacityDelta > 0 ? '+' : '−'}${Math.abs(e.trafficImpact.capacityDelta)}`, tone: e.trafficImpact.capacityDelta > 0 ? 'good' : 'bad' });
  if (e.approvalDelta !== 0) out.push({ text: `Happiness ${e.approvalDelta > 0 ? '+' : '−'}${Math.abs(e.approvalDelta)} pts`, tone: e.approvalDelta > 0 ? 'good' : 'bad' });
  return out;
}

/** The two money figures of an option: now, and each hour. */
function moneyChips(e: StateDelta): Chip[] {
  const out: Chip[] = [{ text: e.budgetDelta === 0 ? 'Free now' : `${signed(e.budgetDelta)} now`, tone: e.budgetDelta < 0 ? 'bad' : e.budgetDelta > 0 ? 'good' : 'plain' }];
  if (e.hourlyNetDelta !== 0) out.push({ text: `${signed(e.hourlyNetDelta)} an hour`, tone: e.hourlyNetDelta < 0 ? 'bad' : 'good' });
  return out;
}

function Chips(props: { list: Chip[] }): JSX.Element | null {
  if (props.list.length === 0) return null;
  return (
    <div class="fx-chips">
      {props.list.map((c) => (
        <span class={`fx-chip tone-${c.tone}`} key={c.text}>
          {c.text}
        </span>
      ))}
    </div>
  );
}

function costLine(o: CouncilOptionView): string {
  const now = o.cost > 0 ? `${usd(o.cost)} now` : o.cost < 0 ? `+${usd(-o.cost)} now` : 'no upfront cost';
  const hourly = o.hourly > 0 ? `, ${usd(o.hourly)} an hour` : o.hourly < 0 ? `, saves ${usd(-o.hourly)} an hour` : '';
  return now + hourly;
}

const STANCE_LABEL: Record<Stance, string> = { propose: 'Proposes', support: 'Supports', concern: 'Concerned', oppose: 'Objects', neutral: 'Neutral' };

type Who = MinistryId | 'chief';

function who(id: Who): { name: string; title: string; short: string; color: string; looks: (typeof CHIEF_SECRETARY)['looks'] } {
  if (id === 'chief') return { name: CHIEF_SECRETARY.name, title: CHIEF_SECRETARY.title, short: 'Chair', color: CHIEF_SECRETARY.color, looks: CHIEF_SECRETARY.looks };
  const m = MINISTER_BY_ID[id];
  return { name: m.name, title: m.title, short: m.short, color: m.color, looks: m.looks };
}

// ---------------------------------------------------------------------------------------
// Top bar: what is being decided, and how far the meeting has got

const STEPS = ['Briefing', 'Round 1', 'Round 2', 'Chair', 'Your decision'];

/** Which step the meeting is on, as the player sees it (statements are shown as they are spoken). */
function stepOf(v: CouncilView): number {
  if (v.phase === 'brief') return 0;
  if (v.phase === 'decided' || v.phase === 'enacted') return 4;
  if (v.speaking?.who === 'chief' || v.chief === 'spoke') return 3;
  const shown = v.messages.some((m) => m.round === 2) ? 2 : 1;
  // Everyone has spoken and only the chair is still working: the chair's step.
  const waitingOnChair = v.chief === 'thinking' && !v.speaking && !v.seats.some((s) => s.state === 'thinking' || s.state === 'speaking');
  return waitingOnChair ? 3 : shown;
}

function Stepper(props: { v: CouncilView }): JSX.Element {
  const { v } = props;
  const at = stepOf(v);
  // Round 2 is only held when the ministers disagree.
  const skipped2 = at >= 3 && !v.messages.some((m) => m.round === 2);
  return (
    <ol class="cb-steps" aria-label="Progress of the meeting">
      {STEPS.map((label, i) => {
        const state = i === 2 && skipped2 ? 'skipped' : i < at ? 'done' : i === at ? 'now' : 'todo';
        return (
          <li key={label} class={`is-${state}`} aria-current={state === 'now' ? 'step' : undefined} title={state === 'skipped' ? 'Not needed: the ministers agreed in round 1' : undefined}>
            <span class="cb-step-dot" />
            {label}
          </li>
        );
      })}
    </ol>
  );
}

function TopBar(props: { v: CouncilView; minutes: boolean; onMinutes: () => void }): JSX.Element {
  const { v } = props;
  const inspecting = ui.inspector.value;
  const lead = MINISTER_BY_ID[v.issue.lead];
  const sev = v.issue.severity > 0.75 ? 'high' : v.issue.severity > 0.45 ? 'mid' : 'low';
  return (
    <header class="cb-top">
      <div class="cb-title">
        <h2>
          {v.issue.title}
          <span class={`sev ${sev}`}>{sev === 'high' ? 'Urgent' : sev === 'mid' ? 'Serious' : 'Minor'}</span>
        </h2>
        <p>
          {v.issue.summary} Raised by {lead.name}.
        </p>
      </div>
      <Stepper v={v} />
      <div class="cb-tools">
        <span class="source" title="Where the ministers' words come from">
          {v.source === 'AI' ? 'AI ministers' : v.source}
        </span>
        {v.phase !== 'brief' && (
          <button type="button" class={`inspect-btn${props.minutes ? ' is-on' : ''}`} aria-pressed={props.minutes} title="Everything said so far" onClick={props.onMinutes}>
            Minutes{v.messages.length ? ` (${v.messages.length})` : ''}
          </button>
        )}
        <button type="button" class={`inspect-btn${inspecting ? ' is-on' : ''}`} aria-pressed={inspecting} title="AI inspector: the agent graph, prompts, JSON, latency and tokens (I)" onClick={() => actions.toggleInspector()}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="3" cy="8" r="1.8" />
            <circle cx="13" cy="3.5" r="1.8" />
            <circle cx="13" cy="12.5" r="1.8" />
            <path d="M4.7 7.2 11.3 4.2M4.7 8.8l6.6 3" />
          </svg>
          Inspector
        </button>
        <button type="button" class="icon-btn" aria-label="Leave the council" title="Leave (Esc)" onClick={() => actions.closeCouncil()}>
          ×
        </button>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------------------
// The division board

/**
 * The mayor's approval, shaped by the money rules: an option the treasury cannot cover is
 * offered together with the loan that pays for it, and one beyond even that cannot be
 * approved at all.
 */
function ApproveButton(props: { o: CouncilOptionView; primary: boolean; short?: boolean }): JSX.Element {
  const { o } = props;
  const cls = `btn ${props.primary ? 'btn-go' : ''}`;
  const status = o.feasibility.status;
  if (status === 'unaffordable' || status === 'blocked' || (status === 'needs_loan' && !o.financing)) {
    return (
      <button type="button" class={cls} disabled title={o.feasibility.reason}>
        {status === 'blocked' ? 'Not possible' : 'Cannot afford'}
      </button>
    );
  }
  if (status === 'needs_loan' && o.financing) {
    return (
      <button type="button" class={cls} title={o.feasibility.reason} onClick={() => actions.approveOption(o.id, true)}>
        {props.short ? `Approve ${o.id} with loan` : `Approve option ${o.id} with a ${usd(o.financing.amount)} loan`}
      </button>
    );
  }
  return (
    <button type="button" class={cls} onClick={() => actions.approveOption(o.id)}>
      {props.short ? (o.hasActions ? `Approve ${o.id}` : 'Do nothing') : o.hasActions ? `Approve option ${o.id}: ${costLine(o)}` : 'Agree: take no action'}
    </button>
  );
}

const PLATE_STATE: Record<SeatState, string> = { waiting: 'listening', thinking: 'preparing', speaking: 'speaking', spoke: 'has spoken', silent: 'no comment', failed: 'unreachable' };

/** A minister's nameplate. On the board it sits under the option they back. */
function Plate(props: { id: Who; state: SeatState; stance?: Stance; note?: string }): JSX.Element {
  const p = who(props.id);
  const label = props.stance ? STANCE_LABEL[props.stance].toLowerCase() : PLATE_STATE[props.state];
  return (
    <span class={`plate is-${props.state}${props.stance ? ` st-${props.stance}` : ''}`} style={{ '--c': p.color }} title={`${p.name}, ${p.title}: ${label}${props.note ? `. ${props.note}` : ''}`}>
      <Portrait looks={p.looks} color={p.color} size={20} />
      <span class="plate-name">{p.short}</span>
      {props.state === 'thinking' && (
        <span class="dots inline" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
    </span>
  );
}

function Column(props: { v: CouncilView; o: CouncilOptionView; open: boolean; onToggle: () => void }): JSX.Element {
  const { v, o } = props;
  const recommended = v.decision?.option === o.id;
  const latest = (m: MinistryId): Stance | undefined => [...v.messages].reverse().find((x) => x.who === m)?.stance;
  const seatState = (m: MinistryId): SeatState => v.seats.find((s) => s.id === m)?.state ?? 'spoke';
  const broken = o.violations && o.violations.length > 0;
  const blocked = o.feasibility.status !== 'ok';
  return (
    <article class={`board-col${recommended ? ' is-recommended' : ''}${props.open ? ' is-open' : ''}`} aria-label={`Option ${o.id}: ${o.title}`}>
      {props.open && (
        <div class="board-more panel" role="region" aria-label={`Option ${o.id} in full`}>
          <p class="board-gist">{o.gist}</p>
          <Chips list={[...moneyChips(o.effects), ...effectChips(o.effects)]} />
          <ul class="opt-facts">
            {o.facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      <button type="button" class="board-head" aria-expanded={props.open} onClick={props.onToggle} title={props.open ? 'Hide the details' : 'Show everything about this option'}>
        <span class="board-letter">{o.id}</span>
        <span class="board-title">{o.title}</span>
        {recommended && <span class="board-tag">Recommended</span>}
      </button>
      <Chips list={moneyChips(o.effects)} />
      <Chips list={effectChips(o.effects).slice(0, 3)} />
      {(blocked || broken) && (
        <p class={`board-warn ${o.feasibility.status === 'needs_loan' && !broken ? 'is-warn' : 'is-bad'}`} role="note" title={blocked ? o.feasibility.reason : undefined}>
          {broken ? `Against your instruction: ${o.violations!.join(', ')}` : o.feasibility.status === 'needs_loan' ? `Needs a loan of ${usd(o.feasibility.shortfall)} first` : o.feasibility.status === 'unaffordable' ? 'The city cannot pay for this' : 'Not possible right now'}
        </p>
      )}
      <div class="board-plates" aria-label={o.backers.length ? `Backed by ${o.backers.map((m) => MINISTER_BY_ID[m].short).join(', ')}` : 'Nobody backs this yet'}>
        {o.backers.map((m) => (
          <Plate id={m} key={m} state={seatState(m)} stance={latest(m)} note={`Backs option ${o.id}`} />
        ))}
      </div>
      {v.phase === 'decided' && (
        <div class="board-approve">
          <ApproveButton o={o} primary={recommended} short />
        </div>
      )}
    </article>
  );
}

function Board(props: { v: CouncilView }): JSX.Element {
  const { v } = props;
  const [open, setOpen] = useState<string | null>(null);
  const backing = new Set(v.options.flatMap((o) => o.backers));
  // Ministers who have not put their plate under an option yet, and the chair.
  const waiting = v.seats.filter((s) => !backing.has(s.id));
  const trayTitle = v.phase === 'brief' ? 'Called in' : waiting.length ? 'Yet to choose' : 'In the chair';
  return (
    <section class="board panel" style={{ '--cols': v.options.length }} aria-label="The options and who backs each">
      {v.options.map((o) => (
        <Column v={v} o={o} key={o.id} open={open === o.id} onToggle={() => setOpen(open === o.id ? null : o.id)} />
      ))}
      <div class="board-tray">
        <div class="board-tray-title">{trayTitle}</div>
        <div class="board-plates">
          {waiting.map((s) => (
            <Plate id={s.id} key={s.id} state={s.state} note={`Called in because ${s.reason}`} />
          ))}
          <Plate id="chief" state={v.chief} />
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------
// Briefing

/**
 * What the game understood of the mayor's instruction. The whole text goes to the
 * ministers, but only these parts are rules the council cannot break, so they are shown
 * before the meeting rather than discovered after it.
 */
function Enforced(props: { note: string }): JSX.Element | null {
  if (!props.note.trim()) return null;
  const rules = parseInstruction(props.note);
  return (
    <p class="enforced small" aria-live="polite">
      {rules.length > 0 ? (
        <>
          <span class="enforced-label">Enforced by rule</span>
          {rules.map((r) => (
            <span class="fx-chip" key={r.id}>
              {r.label}
            </span>
          ))}
          <span class="muted">The rest is passed to the ministers as advice.</span>
        </>
      ) : (
        <span class="muted">Passed to the ministers as advice. Limits such as “under $5,000”, “no demolition”, “no loans” or “no tax rise” are also enforced by rule.</span>
      )}
    </p>
  );
}

function Brief(props: { v: CouncilView }): JSX.Element {
  const { v } = props;
  const [note, setNote] = useState('');
  const [lang, setLang] = useState<Lang>(v.lang);
  const others = MINISTERS.filter((m) => !v.seats.some((s) => s.id === m.id));
  const live = v.source === 'AI' && v.aiReady;
  return (
    <div class="brief-card sheet panel">
      <div class="sheet-cols">
        <section>
          <h3>What the council has been told</h3>
          <ul class="brief-facts">
            {v.issue.facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          {v.memory.length > 0 && (
            <>
              <h3>What it remembers</h3>
              <ul class="brief-memory">
                {v.memory.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section>
          <h3>Who is called in, and why</h3>
          <ul class="triage">
            {v.triage
              .filter((t) => t.role !== 'standby')
              .map((t) => {
                const m = MINISTER_BY_ID[t.ministry];
                return (
                  <li key={t.ministry} style={{ '--c': m.color }} title={`${m.name}: ${t.kpi}`}>
                    <span class="triage-name">{m.short}</span>
                    <span class="triage-bar" aria-label={`Urgency ${Math.round(t.urgency * 100)}%`}>
                      <i style={{ width: `${Math.round(t.urgency * 100)}%` }} />
                    </span>
                    <span class="triage-why">{t.role === 'lead' ? 'raised the issue' : t.reason}</span>
                  </li>
                );
              })}
          </ul>
          {others.length > 0 && <p class="muted small">Not affected enough to attend: {others.map((m) => m.short).join(', ')}.</p>}
        </section>
      </div>
      <label class="note">
        <span>Your instructions to the council (optional)</span>
        <textarea rows={2} maxLength={400} placeholder="e.g. Don't demolish homes. Keep the cost under $5,000." value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
      </label>
      <Enforced note={note} />
      <div class="brief-row">
        <div class="seg" role="group" aria-label="Language of the debate">
          <button type="button" class={lang === 'en' ? 'is-on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
            English
          </button>
          <button type="button" class={lang === 'hi' ? 'is-on' : ''} aria-pressed={lang === 'hi'} onClick={() => setLang('hi')}>
            हिन्दी
          </button>
        </div>
        <p class="muted small brief-how">
          {v.source !== 'AI'
            ? 'Rule-based ministers argue from the figures on the board.'
            : live
              ? `Ministers speak through ${v.providers[0] ?? 'the AI'}, in at most ${v.seats.length * 2} short calls. If it is rate-limited, the offline council takes over.`
              : 'No AI is connected, so rule-based ministers will argue from the same figures.'}
        </p>
        <div class="brief-btns">
          {live && (
            <button type="button" class="btn" title="Rule-based ministers argue from the same figures. No AI call, no tokens." onClick={() => actions.startCouncil(note, lang, true)}>
              Hold it offline
            </button>
          )}
          {/* With no AI behind the game (no keys, or a static build) the meeting simply runs offline. */}
          <button type="button" class="btn btn-go" onClick={() => actions.startCouncil(note, lang, !live)}>
            Begin the meeting
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Debate: the speaker's caption

/** Typing takes this share of a statement's speaking time; the rest is a pause after it. */
const TYPING = 0.82;

/** The statement being delivered, typed out at the pace it is spoken. */
function Subtitle(props: { v: CouncilView }): JSX.Element | null {
  const sp = props.v.speaking;
  const m = sp ? props.v.messages.find((x) => x.key === sp.key) : undefined;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!m || !sp) return;
    const start = performance.now();
    const total = m.text.length;
    setShown(0);
    const id = window.setInterval(() => {
      const k = Math.min(1, (performance.now() - start) / 1000 / (sp.seconds * TYPING));
      setShown(Math.ceil(total * k));
      if (k >= 1) window.clearInterval(id);
    }, 40);
    return () => window.clearInterval(id);
  }, [sp?.key]);
  if (!m || !sp) return null;
  const p = who(m.who);
  const chief = m.who === 'chief';
  return (
    <div class="subtitle panel" style={{ '--c': p.color }} key={sp.key}>
      <span class="subtitle-ring">
        <LivePortrait looks={p.looks} color={p.color} size={84} title={p.name} text={m.text} seconds={sp.seconds * TYPING} stance={m.stance ?? 'neutral'} />
      </span>
      <div class="subtitle-body">
        <div class="msg-head">
          <strong>{p.name}</strong>
          <span class="muted">{chief ? p.title : p.title.replace(/^Minister of /, '')}</span>
          {m.stance && <span class={`stance st-${m.stance}`}>{STANCE_LABEL[m.stance]}</span>}
          {m.option && m.option !== 'none' && <span class="opt-chip">{chief ? `Recommends ${m.option}` : `Backs ${m.option}`}</span>}
          {m.standIn && (
            <span class="opt-chip is-standin" title="The AI could not answer for this seat, so its rule-based stand-in spoke. No tokens were spent.">
              Offline stand-in
            </span>
          )}
        </div>
        <p lang={props.v.lang === 'hi' ? 'hi' : 'en'}>
          {m.text.slice(0, shown)}
          <span class="ghost">{m.text.slice(shown)}</span>
        </p>
        {m.condition && shown >= m.text.length && <p class="msg-cond">Condition: {m.condition}</p>}
      </div>
      <button type="button" class="skip-btn" onClick={() => actions.skipSpeech()} title="Show everything said so far">
        Skip
      </button>
    </div>
  );
}

/** Between speeches: who is still working out what to say. */
function Waiting(props: { v: CouncilView }): JSX.Element | null {
  const { v } = props;
  const ids: Who[] = v.seats.filter((s) => s.state === 'thinking').map((s) => s.id);
  if (v.chief === 'thinking') ids.push('chief');
  if (ids.length === 0) return null;
  return (
    <div class="waiting panel">
      <span>
        {ids.length === 1 ? `${who(ids[0]!).name} is preparing a statement` : `${ids.map((id) => who(id).short).join(', ')} are preparing their statements`}
        <span class="dots inline" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Minutes: everything said, on request

function Message(props: { m: CouncilMessage }): JSX.Element {
  const p = who(props.m.who);
  const chief = props.m.who === 'chief';
  return (
    <div class={`msg${chief ? ' is-chief' : ''}`} style={{ '--c': p.color }}>
      <Portrait looks={p.looks} color={p.color} size={34} />
      <div class="msg-body">
        <div class="msg-head">
          <strong>{p.name}</strong>
          <span class="muted">{p.short === 'Chair' ? p.title : p.short}</span>
          {props.m.stance && <span class={`stance st-${props.m.stance}`}>{STANCE_LABEL[props.m.stance]}</span>}
          {props.m.option && props.m.option !== 'none' && <span class="opt-chip">{chief ? `Recommends ${props.m.option}` : `Backs ${props.m.option}`}</span>}
          {props.m.standIn && (
            <span class="opt-chip is-standin" title="The AI could not answer for this seat, so its rule-based stand-in spoke. No tokens were spent.">
              Offline stand-in
            </span>
          )}
        </div>
        <p lang={ui.council.value?.lang === 'hi' ? 'hi' : 'en'}>{props.m.text}</p>
        {props.m.condition && <p class="msg-cond">Condition: {props.m.condition}</p>}
        {props.m.flags?.map((f) => (
          <p class="msg-flag" key={f} title="Checked by code against the facts this minister was shown">
            Unverified: {f}
          </p>
        ))}
      </div>
    </div>
  );
}

const ROUND_TITLE: Record<number, string> = { 1: 'Round 1: opening statements', 2: 'Round 2: final positions', 3: 'The Chief Secretary sums up' };

function Minutes(props: { v: CouncilView; onClose: () => void }): JSX.Element {
  const { v } = props;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [v.messages.length, v.phase]);
  const rounds: number[] = [];
  for (const m of v.messages) if (!rounds.includes(m.round)) rounds.push(m.round);
  return (
    <aside class="minutes panel" aria-label="Minutes of the meeting">
      <header>
        <h3>Minutes</h3>
        <button type="button" class="icon-btn" aria-label="Close the minutes" onClick={props.onClose}>
          ×
        </button>
      </header>
      <div class="transcript" aria-live="polite">
        {rounds.length === 0 && <p class="muted small">Nothing said yet. Statements are added here as each minister speaks.</p>}
        {rounds.map((r) => (
          <section key={r}>
            <div class="round-title">{ROUND_TITLE[r]}</div>
            {v.messages
              .filter((m) => m.round === r)
              .map((m) => (
                <Message m={m} key={m.key} />
              ))}
          </section>
        ))}
        <div ref={end} />
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------------------
// The ruling

/**
 * What code found when it checked the recommendation: the hard rules of the game (the
 * option exists, the game accepts it, the city can pay) and whether the figures quoted
 * were in the facts shown. No second model is involved.
 */
function Checks(props: { v: CouncilView }): JSX.Element | null {
  const g = props.v.decision?.guardrail;
  if (!g) return null;
  const failed = g.findings.filter((f) => !f.passed);
  const passed = g.findings.length - failed.length;
  return (
    <div class={`checks is-${g.status}`}>
      <div class="checks-head">
        <span class="checks-badge">{g.status === 'pass' ? 'Checked' : g.status === 'flagged' ? 'Checked, with notes' : 'Corrected by the rules'}</span>
        <span>
          {passed} of {g.findings.length} checks passed, by code
        </span>
        <button type="button" class="link-btn" onClick={() => (ui.inspector.value = true)}>
          See how
        </button>
      </div>
      {g.overrideReason && <p class="small">{g.overrideReason}</p>}
      {g.status !== 'overridden' &&
        failed.map((f) => (
          <p class="small" key={f.check}>
            {f.detail}
          </p>
        ))}
    </div>
  );
}

function Verdict(props: { v: CouncilView }): JSX.Element | null {
  const { v } = props;
  const d = v.decision;
  if (!d) return null;
  const rec = v.options.find((o) => o.id === d.option);
  return (
    <div class="verdict sheet panel">
      <div class="verdict-title">
        The Chief Secretary recommends option {d.option}: {rec?.title}
      </div>
      <p>{d.summary}</p>
      {d.dissent && <p class="verdict-aside">Dissent: {d.dissent}</p>}
      {d.conditions && <p class="verdict-aside">Conditions: {d.conditions}</p>}
      <Checks v={v} />
      {v.result && (
        <div class={`council-result ${v.result.ok ? 'good' : 'bad'}`}>
          {v.result.text}
          {v.result.ok && v.result.observed && (
            <>
              <Chips list={[...moneyChips(v.result.observed), ...effectChips(v.result.observed).filter((c) => !c.text.startsWith('Happiness'))]} />
              <div class="result-note">{v.result.drift?.length ? `Differs from the board in ${v.result.drift.map((x) => x.field).join(', ')}.` : 'Measured in the city after the change: exactly what the board promised.'}</div>
            </>
          )}
        </div>
      )}
      <div class="verdict-btns">
        {v.phase === 'decided' && rec && <ApproveButton o={rec} primary />}
        <button type="button" class="btn" onClick={() => actions.closeCouncil()}>
          {v.phase === 'enacted' ? 'Back to the city' : 'Decide later'}
        </button>
        {v.phase === 'decided' && <span class="muted small">You are the mayor: approve this, approve another option on the board, or decide later.</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------

export function CouncilChamber(): JSX.Element | null {
  const v = ui.council.value;
  const [minutes, setMinutes] = useState(false);
  if (!v || ui.cinema.value !== 'inside') return null;
  const inspecting = ui.inspector.value;
  // One thing at a time on the right: the inspector takes the place of the minutes.
  const side = inspecting ? 'inspector' : minutes && v.phase !== 'brief' ? 'minutes' : 'none';
  return (
    <div class={`chamber-ui side-${side} phase-${v.phase}`} role="dialog" aria-modal="true" aria-label={`City council: ${v.issue.title}`}>
      <TopBar
        v={v}
        minutes={side === 'minutes'}
        onMinutes={() => {
          if (inspecting) ui.inspector.value = false;
          setMinutes(inspecting ? true : !minutes);
        }}
      />
      {side === 'minutes' && <Minutes v={v} onClose={() => setMinutes(false)} />}
      {inspecting && <Inspector />}
      <div class="cb-floor">
        {v.notice && v.phase !== 'brief' && (
          <div class="council-notice panel" role="status">
            {v.notice}
          </div>
        )}
        {v.phase === 'brief' && <Brief v={v} />}
        {v.phase === 'debate' && (v.speaking ? <Subtitle v={v} /> : <Waiting v={v} />)}
        {(v.phase === 'decided' || v.phase === 'enacted') && <Verdict v={v} />}
        {v.phase === 'error' && (
          <div class="council-alert panel">
            <strong>The meeting could not go ahead.</strong> {v.error}
            <div class="brief-btns">
              <button type="button" class="btn" onClick={() => actions.startCouncil('', v.lang, true)}>
                Hold it offline
              </button>
              <button type="button" class="btn" onClick={() => actions.closeCouncil()}>
                Back to the city
              </button>
            </div>
          </div>
        )}
        <Board v={v} />
      </div>
    </div>
  );
}
