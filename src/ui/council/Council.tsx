import type { JSX } from 'preact';
import { MINISTER_BY_ID } from '../../game/council/ministries';
import { actions, ui } from '../store';
import { Portrait } from './Portrait';
import './council.css';

export { CouncilChamber } from './Chamber';

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
