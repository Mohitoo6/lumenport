import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { CHIEF_SECRETARY, MINISTER_BY_ID, MINISTERS, type MinistryId } from '../../game/council/ministries';
import type { Lang, Stance } from '../../game/council/prompts';
import { actions, ui, type CouncilMessage, type CouncilOptionView, type CouncilView, type SeatState } from '../store';
import { Portrait } from './Portrait';
import './council.css';

const usd = (n: number): string => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

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

function Seat(props: { id: MinistryId | 'chief'; state: SeatState; reason?: string }): JSX.Element {
  const p = who(props.id);
  const label = props.state === 'thinking' ? 'speaking…' : props.state === 'silent' ? 'no comment' : props.state === 'failed' ? 'unreachable' : props.state === 'spoke' ? 'has spoken' : 'listening';
  return (
    <div class={`seat is-${props.state}`} style={{ '--c': p.color }} title={`${p.name}, ${p.title}${props.reason ? ` · called in because ${props.reason}` : ''}`}>
      <div class="seat-ring">
        <Portrait looks={p.looks} color={p.color} size={52} title={p.name} />
      </div>
      <div class="seat-name">{p.name.replace(/^Dr\. /, 'Dr ')}</div>
      <div class="seat-role">{p.short}</div>
      <div class="seat-state">{label}</div>
    </div>
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
      <ul class="opt-facts">
        {o.facts.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
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
          {o.x !== undefined && o.z !== undefined && (
            <button type="button" class="link-btn" onClick={() => actions.lookAt(o.x!, o.z!)}>
              Show on map
            </button>
          )}
          {props.canApprove && (
            <button type="button" class={`btn ${props.recommended ? 'btn-go' : ''}`} onClick={() => actions.approveOption(o.id)}>
              {o.hasActions ? `Approve ${o.id}` : 'Do nothing'}
            </button>
          )}
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
        </div>
        <p lang={ui.council.value?.lang === 'hi' ? 'hi' : 'en'}>{props.m.text}</p>
        {props.m.condition && <p class="msg-cond">Condition: {props.m.condition}</p>}
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
      <p class="muted small">
        Called in: {v.seats.map((s) => MINISTER_BY_ID[s.id].short).join(', ')}.{others.length ? ` Not affected, so not attending: ${others.map((m) => m.short).join(', ')}.` : ''}
      </p>
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
          {!v.aiReady && (
            <button type="button" class="btn" onClick={() => actions.startCouncil(note, lang, true)}>
              Demo meeting
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
            ? `Ministers speak through ${v.providers[0] ?? 'the AI'}${v.providers.length > 1 ? ` (falls back to ${v.providers.slice(1).join(', ')})` : ''}. The city is paused during the meeting.`
            : 'No AI keys found: add them to .env and restart the game, or hold a demo meeting with scripted ministers.'}
        </p>
      )}
    </div>
  );
}

function Transcript(props: { v: CouncilView }): JSX.Element {
  const { v } = props;
  const end = useRef<HTMLDivElement>(null);
  const thinking = v.seats.filter((s) => s.state === 'thinking').map((s) => s.id as MinistryId | 'chief');
  if (v.chief === 'thinking') thinking.push('chief');
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [v.messages.length, thinking.length, v.phase]);
  const rounds: number[] = [];
  for (const m of v.messages) if (!rounds.includes(m.round)) rounds.push(m.round);
  if (v.phase === 'debate' && !rounds.includes(v.round)) rounds.push(v.round);
  return (
    <div class="transcript" aria-live="polite">
      {rounds.map((r) => (
        <section key={r}>
          <div class="round-title">{ROUND_TITLE[r]}</div>
          {v.messages
            .filter((m) => m.round === r)
            .map((m) => (
              <Message m={m} key={m.key} />
            ))}
          {r === v.round &&
            v.phase === 'debate' &&
            thinking.map((id) => {
              const p = who(id);
              return (
                <div class="msg is-typing" key={`t-${id}`} style={{ '--c': p.color }}>
                  <Portrait looks={p.looks} color={p.color} size={40} />
                  <div class="msg-body">
                    <div class="msg-head">
                      <strong>{p.name}</strong>
                      <span class="muted">is speaking</span>
                    </div>
                    <div class="dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                </div>
              );
            })}
        </section>
      ))}
      {v.phase === 'error' && (
        <div class="council-alert">
          <strong>The meeting could not go ahead.</strong> {v.error}
          <div class="brief-btns">
            <button type="button" class="btn" onClick={() => actions.startCouncil('', v.lang, true)}>
              Demo meeting
            </button>
          </div>
        </div>
      )}
      {(v.phase === 'decided' || v.phase === 'enacted') && v.decision && (
        <div class="verdict">
          <div class="label">Council recommendation</div>
          <div class="verdict-title">
            Option {v.decision.option}: {v.options.find((o) => o.id === v.decision!.option)?.title}
          </div>
          {v.decision.dissent && <p class="small">Dissent: {v.decision.dissent}</p>}
          {v.decision.conditions && <p class="small">Conditions: {v.decision.conditions}</p>}
          {v.phase === 'decided' && <p class="muted small">You are the mayor: approve the recommendation, pick another option on the left, or decide later.</p>}
        </div>
      )}
      {v.result && <div class={`council-result ${v.result.ok ? 'good' : 'bad'}`}>{v.result.text}</div>}
      <div ref={end} />
    </div>
  );
}

export function CouncilChamber(): JSX.Element | null {
  const v = ui.council.value;
  if (!v) return null;
  const lead = MINISTER_BY_ID[v.issue.lead];
  const canApprove = v.phase === 'decided' || v.phase === 'error';
  const rec = v.decision?.option;
  const recOption = v.options.find((o) => o.id === rec);
  return (
    <div class="council-backdrop">
      <section class="council panel" role="dialog" aria-modal="true" aria-label={`City council: ${v.issue.title}`}>
        <header class="council-head">
          <div>
            <div class="label">City Council · raised by {lead.name}</div>
            <h2>{v.issue.title}</h2>
            <p class="muted">{v.issue.summary}</p>
          </div>
          <div class="council-head-side">
            <span class={`sev ${v.issue.severity > 0.75 ? 'high' : v.issue.severity > 0.45 ? 'mid' : 'low'}`}>{v.issue.severity > 0.75 ? 'Urgent' : v.issue.severity > 0.45 ? 'Serious' : 'Minor'}</span>
            {(v.issue.x !== 0 || v.issue.z !== 0) && (
              <button type="button" class="link-btn" onClick={() => actions.lookAt(v.issue.x, v.issue.z)}>
                Show on map
              </button>
            )}
            <span class="source">{v.source === 'AI' ? 'AI ministers' : v.source}</span>
            <button type="button" class="icon-btn" aria-label="Close the council" onClick={() => actions.closeCouncil()}>
              ×
            </button>
          </div>
        </header>
        <div class="seats">
          <Seat id="chief" state={v.chief} />
          <div class="seats-sep" />
          {v.seats.map((s) => (
            <Seat id={s.id} state={s.state} reason={s.reason} key={s.id} />
          ))}
        </div>
        <div class="council-body">
          <aside class="options" aria-label="Options">
            <div class="label">Options on the table</div>
            {v.options.map((o) => (
              <OptionCard o={o} key={o.id} recommended={o.id === rec} canApprove={canApprove} />
            ))}
          </aside>
          <div class="council-main">{v.phase === 'brief' ? <Brief v={v} /> : <Transcript v={v} />}</div>
        </div>
        {(v.phase === 'decided' || v.phase === 'enacted') && (
          <footer class="council-foot">
            {v.phase === 'decided' && recOption && (
              <button type="button" class="btn btn-go" onClick={() => actions.approveOption(recOption.id)}>
                {recOption.hasActions ? `Approve option ${recOption.id} · ${costLine(recOption)}` : 'Agree: take no action'}
              </button>
            )}
            <button type="button" class="btn" onClick={() => actions.closeCouncil()}>
              {v.phase === 'enacted' ? 'Back to the city' : 'Decide later'}
            </button>
          </footer>
        )}
      </section>
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
        </div>
      )}
    </div>
  );
}
