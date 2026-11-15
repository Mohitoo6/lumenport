import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { CHIEF_SECRETARY, MINISTER_BY_ID, MINISTERS, type MinistryId } from '../../game/council/ministries';
import type { Lang, Stance } from '../../game/council/prompts';
import type { StateDelta } from '../../game/council/effects';
import { actions, ui, type CouncilMessage, type CouncilOptionView, type CouncilView, type SeatState } from '../store';
import { Inspector } from './Inspector';
import { Portrait } from './Portrait';
import './council.css';

const usd = (n: number): string => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const signed = (n: number): string => `${n < 0 ? '−' : '+'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

interface Chip {
  text: string;
  tone: 'good' | 'bad' | 'plain';
}

/**
 * An option's measured payload as chips: what approving it does to the city. Money is
 * always shown; the rest only where the option changes it.
 */
function effectChips(e: StateDelta): Chip[] {
  const out: Chip[] = [];
  out.push({ text: e.budgetDelta === 0 ? 'Free now' : `${signed(e.budgetDelta)} now`, tone: e.budgetDelta < 0 ? 'bad' : e.budgetDelta > 0 ? 'good' : 'plain' });
  if (e.monthlyNetDelta !== 0) out.push({ text: `${signed(e.monthlyNetDelta)}/mo`, tone: e.monthlyNetDelta < 0 ? 'bad' : 'good' });
  if (e.taxRateDelta.some((d) => d !== 0)) out.push({ text: `Tax ${e.taxRateDelta.map((d) => (d > 0 ? `+${d}` : String(d))).join('/')} pts`, tone: 'bad' });
  if (e.debtDelta > 0) out.push({ text: `Debt +${usd(e.debtDelta)}`, tone: 'bad' });
  if (e.residentsDisplaced > 0) out.push({ text: `${e.residentsDisplaced} residents displaced`, tone: 'bad' });
  if (e.jobsLost > 0) out.push({ text: `${e.jobsLost} jobs lost`, tone: 'bad' });
  if (e.powerSupplyDelta !== 0) out.push({ text: `Power ${e.powerSupplyDelta > 0 ? '+' : '−'}${Math.abs(e.powerSupplyDelta)} MW`, tone: e.powerSupplyDelta > 0 ? 'good' : 'bad' });
  if (e.waterSupplyDelta !== 0) out.push({ text: `Water ${e.waterSupplyDelta > 0 ? '+' : '−'}${Math.abs(e.waterSupplyDelta).toLocaleString('en-US')}`, tone: e.waterSupplyDelta > 0 ? 'good' : 'bad' });
  if (e.trafficImpact.rushPeakFactor !== 1) out.push({ text: `Rush peak ${Math.round(e.trafficImpact.rushPeakFactor * 100)}%`, tone: e.trafficImpact.rushPeakFactor < 1 ? 'good' : 'bad' });
  if (e.trafficImpact.capacityDelta !== 0) out.push({ text: `Road capacity ${e.trafficImpact.capacityDelta > 0 ? '+' : '−'}${Math.abs(e.trafficImpact.capacityDelta)}`, tone: e.trafficImpact.capacityDelta > 0 ? 'good' : 'bad' });
  if (e.approvalDelta !== 0) out.push({ text: `Happiness ${e.approvalDelta > 0 ? '+' : '−'}${Math.abs(e.approvalDelta)} pts`, tone: e.approvalDelta > 0 ? 'good' : 'bad' });
  return out;
}

function Chips(props: { list: Chip[] }): JSX.Element {
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
  const now = o.cost > 0 ? `${usd(o.cost)} now` : o.cost < 0 ? `+${usd(-o.cost)} now` : 'No upfront cost';
  const monthly = o.monthly > 0 ? ` · ${usd(o.monthly)}/mo` : o.monthly < 0 ? ` · saves ${usd(-o.monthly)}/mo` : '';
  return now + monthly;
}

const STANCE_LABEL: Record<Stance, string> = {
  propose: 'Proposes',
  support: 'Supports',
  concern: 'Concerned',
  oppose: 'Objects',
  neutral: 'Neutral',
};

function who(id: MinistryId | 'chief'): { name: string; title: string; short: string; color: string; looks: (typeof CHIEF_SECRETARY)['looks'] } {
  if (id === 'chief') return { name: CHIEF_SECRETARY.name, title: CHIEF_SECRETARY.title, short: 'Chair', color: CHIEF_SECRETARY.color, looks: CHIEF_SECRETARY.looks };
  const m = MINISTER_BY_ID[id];
  return { name: m.name, title: m.title, short: m.short, color: m.color, looks: m.looks };
}

const SEAT_LABEL: Record<SeatState, string> = {
  waiting: 'listening',
  thinking: 'thinking…',
  speaking: 'speaking',
  spoke: 'has spoken',
  silent: 'no comment',
  failed: 'unreachable',
};

function Seat(props: { id: MinistryId | 'chief'; state: SeatState; reason?: string }): JSX.Element {
  const p = who(props.id);
  return (
    <div class={`seat is-${props.state}`} style={{ '--c': p.color }} title={`${p.name}, ${p.title}${props.reason ? ` · called in because ${props.reason}` : ''}`}>
      <div class="seat-ring">
        <Portrait looks={p.looks} color={p.color} size={34} title={p.name} />
      </div>
      <div class="seat-text">
        <div class="seat-name">{p.name.replace(/^Dr\. /, 'Dr ')}</div>
        <div class="seat-role">
          {p.short} · <span class="seat-state">{SEAT_LABEL[props.state]}</span>
        </div>
      </div>
    </div>
  );
}

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
      {props.short ? (o.hasActions ? `Approve ${o.id}` : 'Do nothing') : o.hasActions ? `Approve option ${o.id} · ${costLine(o)}` : 'Agree: take no action'}
    </button>
  );
}

function OptionCard(props: { o: CouncilOptionView; recommended: boolean; canApprove: boolean }): JSX.Element {
  const { o } = props;
  return (
    <article class={`opt${props.recommended ? ' is-recommended' : ''}`}>
      <header>
        <span class="opt-id">{o.id}</span>
        <div class="opt-head">
          <div class="opt-title">{o.title}</div>
          <div class="opt-cost">{costLine(o)}</div>
        </div>
      </header>
      {props.recommended && <div class="opt-ribbon">Council recommends</div>}
      <p class="opt-gist">{o.gist}</p>
      <Chips list={effectChips(o.effects)} />
      {o.feasibility.status !== 'ok' && (
        <p class={`opt-block ${o.feasibility.status === 'needs_loan' ? 'is-warn' : 'is-bad'}`} role="note">
          {o.feasibility.reason}
        </p>
      )}
      <details class="opt-more">
        <summary>Full brief</summary>
        <ul class="opt-facts">
          {o.facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </details>
      <footer>
        <div class="opt-backers" aria-label={`Backed by ${o.backers.length}`}>
          {o.backers.map((m) => (
            <span class="mini" key={m} title={`${MINISTER_BY_ID[m].name} backs ${o.id}`} style={{ '--c': MINISTER_BY_ID[m].color }}>
              <Portrait looks={MINISTER_BY_ID[m].looks} color={MINISTER_BY_ID[m].color} size={22} />
            </span>
          ))}
          {o.backers.length === 0 && <span class="muted small">No backers yet</span>}
        </div>
        <div class="opt-btns">
          {props.canApprove && <ApproveButton o={o} primary={props.recommended} short />}
        </div>
      </footer>
    </article>
  );
}

function Message(props: { m: CouncilMessage }): JSX.Element {
  const p = who(props.m.who);
  const chief = props.m.who === 'chief';
  return (
    <div class={`msg${chief ? ' is-chief' : ''}`} style={{ '--c': p.color }}>
      <Portrait looks={p.looks} color={p.color} size={40} />
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
            Unverified figure: {f}
          </p>
        ))}
      </div>
    </div>
  );
}

const ROUND_TITLE: Record<number, string> = {
  1: 'Round 1 · Opening statements',
  2: 'Round 2 · Final positions',
  3: 'Chief Secretary sums up',
};

function Brief(props: { v: CouncilView }): JSX.Element {
  const { v } = props;
  const [note, setNote] = useState('');
  const [lang, setLang] = useState<Lang>(v.lang);
  const others = MINISTERS.filter((m) => !v.seats.some((s) => s.id === m.id));
  return (
    <div class="brief">
      <h3 class="label">Briefing</h3>
      <ul class="brief-facts">
        {v.issue.facts.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <h3 class="label">Who is called in · scored by each department</h3>
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
      {v.memory.length > 0 && (
        <>
          <h3 class="label">The council remembers</h3>
          <ul class="brief-memory">
            {v.memory.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </>
      )}
      <label class="note">
        <span>Your instructions to the council (optional)</span>
        <textarea
          rows={2}
          maxLength={400}
          placeholder="e.g. Don't demolish homes. Keep the cost under $5,000."
          value={note}
          onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
        />
      </label>
      <div class="brief-row">
        <div class="seg" role="group" aria-label="Language of the debate">
          <button type="button" class={lang === 'en' ? 'is-on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
            English
          </button>
          <button type="button" class={lang === 'hi' ? 'is-on' : ''} aria-pressed={lang === 'hi'} onClick={() => setLang('hi')}>
            हिन्दी
          </button>
        </div>
        <div class="brief-btns">
          {v.source === 'AI' && (
            <button type="button" class="btn" title="Rule-based ministers argue from the same figures. No AI call, no tokens." onClick={() => actions.startCouncil(note, lang, true)}>
              Hold it offline · 0 tokens
            </button>
          )}
          <button type="button" class="btn btn-go" disabled={!v.aiReady && v.source === 'AI'} onClick={() => actions.startCouncil(note, lang, v.source !== 'AI')}>
            Begin the meeting
          </button>
        </div>
      </div>
      {v.source === 'AI' && (
        <p class="muted small">
          {v.aiReady
            ? `Ministers speak through ${v.providers[0] ?? 'the AI'}${v.providers.length > 1 ? ` (falls back to ${v.providers.slice(1).join(', ')})` : ''}: at most ${v.seats.length * 2} short calls. If the AI is rate-limited mid-meeting, the offline council takes over. The city is paused.`
            : 'No AI keys found: add them to .env and restart the game, or hold the meeting offline with rule-based ministers.'}
        </p>
      )}
    </div>
  );
}

function Transcript(props: { v: CouncilView }): JSX.Element {
  const { v } = props;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [v.messages.length, v.phase]);
  const rounds: number[] = [];
  for (const m of v.messages) if (!rounds.includes(m.round)) rounds.push(m.round);
  return (
    <div class="transcript" aria-live="polite">
      {rounds.length === 0 && <p class="muted small">Nothing said yet. Statements appear here as each minister speaks.</p>}
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
  );
}

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
      const k = Math.min(1, (performance.now() - start) / 1000 / (sp.seconds * 0.82));
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
        <Portrait looks={p.looks} color={p.color} size={52} />
      </span>
      <div class="subtitle-body">
        <div class="msg-head">
          <strong>{p.name}</strong>
          <span class="muted">{chief ? p.title : p.title.replace(/^Minister of /, '')}</span>
          {m.stance && <span class={`stance st-${m.stance}`}>{STANCE_LABEL[m.stance]}</span>}
          {m.option && m.option !== 'none' && <span class="opt-chip">{chief ? `Recommends ${m.option}` : `Backs ${m.option}`}</span>}
        </div>
        <p lang={props.v.lang === 'hi' ? 'hi' : 'en'}>
          {m.text.slice(0, shown)}
          <span class="ghost">{m.text.slice(shown)}</span>
        </p>
        {m.condition && shown >= m.text.length && <p class="msg-cond">Condition: {m.condition}</p>}
      </div>
      <button type="button" class="skip-btn" onClick={() => actions.skipSpeech()} title="Show everything said so far">
        Skip ›
      </button>
    </div>
  );
}

/** Between speeches: who is still working out what to say. */
function Waiting(props: { v: CouncilView }): JSX.Element | null {
  const { v } = props;
  const ids: Array<MinistryId | 'chief'> = v.seats.filter((s) => s.state === 'thinking').map((s) => s.id);
  if (v.chief === 'thinking') ids.push('chief');
  if (ids.length === 0) return null;
  return (
    <div class="waiting panel">
      <div class="waiting-faces">
        {ids.map((id) => {
          const p = who(id);
          return (
            <span class="mini" key={id} style={{ '--c': p.color }}>
              <Portrait looks={p.looks} color={p.color} size={26} />
            </span>
          );
        })}
      </div>
      <span>
        {ids.length === 1 ? `${who(ids[0]!).name} is preparing a statement` : `${ids.length} ministers are preparing their statements`}
        <span class="dots inline" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </span>
    </div>
  );
}

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
    <div class="verdict panel">
      <div class="label">Council recommendation · Chief Secretary {CHIEF_SECRETARY.name}</div>
      <div class="verdict-title">
        Option {d.option}: {rec?.title}
      </div>
      <p class="small">{d.summary}</p>
      {d.dissent && <p class="small">Dissent: {d.dissent}</p>}
      {d.conditions && <p class="small">Conditions: {d.conditions}</p>}
      <Checks v={v} />
      {v.result && (
        <div class={`council-result ${v.result.ok ? 'good' : 'bad'}`}>
          {v.result.text}
          {v.result.ok && v.result.observed && (
            <>
              <Chips list={effectChips(v.result.observed).filter((c) => !c.text.startsWith('Happiness'))} />
              <div class="result-note">
                {v.result.drift?.length
                  ? `Differs from the option card in ${v.result.drift.map((x) => x.field).join(', ')}.`
                  : 'Measured in the city after the change: exactly what the option card promised.'}
              </div>
            </>
          )}
        </div>
      )}
      <div class="verdict-btns">
        {v.phase === 'decided' && rec && <ApproveButton o={rec} primary />}
        <button type="button" class="btn" onClick={() => actions.closeCouncil()}>
          {v.phase === 'enacted' ? 'Back to the city' : 'Decide later'}
        </button>
      </div>
      {v.phase === 'decided' && <p class="muted small">You are the mayor: approve the recommendation, pick another option on the left, or decide later.</p>}
    </div>
  );
}

export function CouncilChamber(): JSX.Element | null {
  const v = ui.council.value;
  const [showOptions, setShowOptions] = useState(true);
  const [showLog, setShowLog] = useState(true);
  if (!v || ui.cinema.value !== 'inside') return null;
  const lead = MINISTER_BY_ID[v.issue.lead];
  const canApprove = v.phase === 'decided';
  const rec = v.decision?.option;
  const inspecting = ui.inspector.value;
  return (
    <div class={`chamber-ui${inspecting ? ' has-inspector' : ''}`} role="dialog" aria-modal="true" aria-label={`City council: ${v.issue.title}`}>
      <header class="council-head panel">
        <div>
          <div class="label">City Council · raised by {lead.name}</div>
          <h2>{v.issue.title}</h2>
          <p class="muted">{v.issue.summary}</p>
        </div>
        <div class="council-head-side">
          <span class={`sev ${v.issue.severity > 0.75 ? 'high' : v.issue.severity > 0.45 ? 'mid' : 'low'}`}>{v.issue.severity > 0.75 ? 'Urgent' : v.issue.severity > 0.45 ? 'Serious' : 'Minor'}</span>
          <span class="source">{v.source === 'AI' ? 'AI ministers' : v.source}</span>
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

      <aside class={`drawer drawer-left panel${showOptions ? '' : ' is-closed'}`} aria-label="Options">
        <button type="button" class="drawer-tab" aria-expanded={showOptions} onClick={() => setShowOptions(!showOptions)}>
          {showOptions ? '‹' : '›'} Options
        </button>
        {showOptions && (
          <div class="drawer-body options">
            {v.options.map((o) => (
              <OptionCard o={o} key={o.id} recommended={o.id === rec} canApprove={canApprove} />
            ))}
          </div>
        )}
      </aside>

      <aside class={`drawer drawer-right panel${showLog ? '' : ' is-closed'}`} aria-label="Discussion">
        <button type="button" class="drawer-tab" aria-expanded={showLog} onClick={() => setShowLog(!showLog)}>
          Discussion {showLog ? '›' : '‹'}
        </button>
        {showLog && (
          <div class="drawer-body">
            <div class="seats">
              <Seat id="chief" state={v.chief} />
              {v.seats.map((s) => (
                <Seat id={s.id} state={s.state} reason={s.reason} key={s.id} />
              ))}
            </div>
            {v.phase !== 'brief' && <Transcript v={v} />}
          </div>
        )}
      </aside>

      {inspecting && <Inspector />}

      <div class="stage-bottom">
        {v.phase === 'brief' && (
          <div class="brief-card panel">
            <Brief v={v} />
          </div>
        )}
        {v.notice && v.phase !== 'brief' && (
          <div class="council-notice panel" role="status">
            {v.notice}
          </div>
        )}
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
      </div>
    </div>
  );
}

/** A minister asking the mayor for a meeting. */
export function MinisterRequestCard(): JSX.Element | null {
  const r = ui.request.value;
  if (!r || ui.council.value) return null;
  const m = MINISTER_BY_ID[r.minister];
  return (
    <div class="panel request" style={{ '--c': m.color }} role="alertdialog" aria-label={`${m.name} asks for a council meeting`}>
      <div class="request-head">
        <span class="request-ring">
          <Portrait looks={m.looks} color={m.color} size={46} />
        </span>
        <div>
          <div class="request-name">{m.name}</div>
          <div class="muted small">{m.title}</div>
        </div>
      </div>
      <p>{r.text}</p>
      <div class="request-btns">
        <button type="button" class="btn btn-go" onClick={() => actions.convene(r.issueKey)}>
          Call the council
        </button>
        <button type="button" class="btn" onClick={() => actions.dismissRequest()}>
          Not now
        </button>
      </div>
    </div>
  );
}

/** What residents are saying. */
export function CitizenFeed(): JSX.Element | null {
  const posts = ui.posts.value;
  if (posts.length === 0 || ui.council.value) return null;
  return (
    <ul class="feed" aria-label="What residents are saying" aria-live="polite">
      {posts.map((p) => (
        <li key={p.id} class={`post mood-${p.mood}`}>
          <span class="post-avatar" aria-hidden="true">
            {p.name[0]}
          </span>
          <div>
            <div class="post-head">
              <strong>{p.name}</strong> <span class="muted">@{p.handle}</span>
            </div>
            <div class="post-text">{p.text}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Top-bar button listing current problems, from which the mayor can call the council. */
export function IssuesMenu(): JSX.Element {
  const list = ui.issues.value;
  const open = ui.showIssues.value;
  return (
    <div class="issues">
      <button type="button" class={`panel issues-btn${list.length ? ' has-issues' : ''}`} aria-expanded={open} title="City council" onClick={() => (ui.showIssues.value = !open)}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M2 13.5h12M3.5 13.5V7M6.5 13.5V7M9.5 13.5V7M12.5 13.5V7M1.8 6.2 8 2.5l6.2 3.7Z" />
        </svg>
        <span>Council</span>
        {list.length > 0 && <span class="count">{list.length}</span>}
      </button>
      {open && (
        <div class="panel issues-menu" role="menu">
          <div class="label">Problems in the city</div>
          {list.length === 0 && <p class="muted small">Nothing urgent. The council will be called when something comes up.</p>}
          {list.map((i) => {
            const m = MINISTER_BY_ID[i.lead];
            return (
              <button type="button" role="menuitem" class="issue-row" key={i.key} onClick={() => actions.convene(i.key)}>
                <Portrait looks={m.looks} color={m.color} size={28} />
                <span class="issue-text">
                  <span>{i.title}</span>
                  <span class="muted small">{m.short} · call the council</span>
                </span>
                <span class="sevbar" aria-label={`Severity ${Math.round(i.severity * 100)}%`}>
                  <i style={{ width: `${Math.max(8, i.severity * 100)}%`, background: i.severity > 0.75 ? 'var(--bad)' : i.severity > 0.45 ? 'var(--accent)' : 'var(--good)' }} />
                </span>
              </button>
            );
          })}
          <button
            type="button"
            role="menuitem"
            class="issue-row inspect-row"
            onClick={() => {
              ui.showIssues.value = false;
              ui.inspector.value = true;
            }}
          >
            <span class="issue-text">
              <span>AI inspector</span>
              <span class="muted small">
                {ui.aiStats.value.meetings ? `${ui.aiStats.value.meetings} meeting${ui.aiStats.value.meetings > 1 ? 's' : ''} · ${ui.aiStats.value.llmCalls} model calls · ${(ui.aiStats.value.promptTokens + ui.aiStats.value.completionTokens).toLocaleString('en-US')} tokens` : 'Agent graph, prompts, tokens and guardrails'}
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
