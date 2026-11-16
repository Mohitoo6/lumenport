import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { StateDelta } from '../../game/council/effects';
import { NODE_INFO, type GraphNode } from '../../game/council/graph';
import type { Finding } from '../../game/council/guardrails';
import { CHIEF_SECRETARY, MINISTER_BY_ID } from '../../game/council/ministries';
import { BUDGET } from '../../game/council/session';
import type { AgentSpan, CouncilTrace } from '../../game/council/telemetry';
import { actions, ui } from '../store';
import './inspector.css';

/**
 * The AI inspector: the council's machinery, live. Everything on it is measured or
 * computed by code (no model grades another), and it is the same data the game runs on:
 * the graph state, each agent's exact prompt and JSON reply, latency and token counts,
 * schema results, guardrail findings, the option payloads, and what the mayor finally did.
 */

const PIPELINE: GraphNode[] = ['detect', 'triage', 'debate_r1', 'debate_r2', 'synthesis', 'guardrails', 'hitl', 'execute'];

const num = (n: number): string => Math.round(n).toLocaleString('en-US');
const secs = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const usd = (n: number): string => `${n < 0 ? '-' : n > 0 ? '+' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

function agentName(id: AgentSpan['agent']): { short: string; color: string } {
  return id === 'chief' ? { short: 'Chair', color: CHIEF_SECRETARY.color } : { short: MINISTER_BY_ID[id].short, color: MINISTER_BY_ID[id].color };
}

function Section(props: { title: string; note?: string; children: JSX.Element | Array<JSX.Element | null | false> | null | false }): JSX.Element {
  return (
    <section class="ins-section">
      <header>
        <h3>{props.title}</h3>
        {props.note && <span class="ins-note">{props.note}</span>}
      </header>
      {props.children}
    </section>
  );
}

/** The state machine: which nodes ran, which is live, which the router skipped. */
function Pipeline(props: { trace: CouncilTrace }): JSX.Element {
  const { trace } = props;
  const visited = new Set<GraphNode>(['detect', ...trace.transitions.map((t) => t.to)]);
  const currentIndex = PIPELINE.indexOf(trace.node);
  const finished = trace.node === 'done' || trace.node === 'aborted';
  const last = trace.transitions[trace.transitions.length - 1];
  return (
    <div>
      <ol class="ins-graph" aria-label="Pipeline state">
        {PIPELINE.map((n, i) => {
          const live = trace.node === n;
          const done = visited.has(n) && !live;
          const skipped = !visited.has(n) && (finished ? true : currentIndex > i);
          const state = live ? 'live' : done ? 'done' : skipped ? 'skipped' : 'todo';
          return (
            <li key={n} class={`ins-node is-${state}${NODE_INFO[n].llm ? ' is-llm' : ''}`} title={`${NODE_INFO[n].does}${NODE_INFO[n].llm ? ' Calls the model.' : ' Pure code, no tokens.'}`}>
              <span class="ins-dot" />
              <span class="ins-node-label">{NODE_INFO[n].label}</span>
            </li>
          );
        })}
      </ol>
      <p class="ins-state">
        <span class={`ins-pill ${trace.node === 'aborted' ? 'bad' : finished ? 'good' : 'live'}`}>{trace.node === 'done' ? 'done' : trace.node === 'aborted' ? 'aborted' : `at: ${NODE_INFO[trace.node].label}`}</span>
        {last && <span class="ins-muted"> {last.reason}</span>}
      </p>
      <details class="ins-details">
        <summary>Transition log ({trace.transitions.length})</summary>
        <ol class="ins-log">
          {trace.transitions.map((t, i) => (
            <li key={i}>
              <code>
                {t.from} → {t.to}
              </code>
              <span class="ins-muted"> +{secs(t.at)}</span>
              <div>{t.reason}</div>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function Tile(props: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' | 'warn' }): JSX.Element {
  return (
    <div class={`ins-tile${props.tone ? ` tone-${props.tone}` : ''}`}>
      <div class="ins-tile-label">{props.label}</div>
      <div class="ins-tile-value">{props.value}</div>
      {props.sub && <div class="ins-tile-sub">{props.sub}</div>}
    </div>
  );
}

function Totals(props: { trace: CouncilTrace }): JSX.Element {
  const t = props.trace.totals;
  const validated = t.schemaPass + t.schemaRepaired + t.schemaFail;
  return (
    <div class="ins-tiles">
      <Tile label="Model calls" value={`${t.llmCalls} / ${BUDGET.maxCalls}`} sub={t.cacheHits || t.policyTurns ? `${t.cacheHits} cached · ${t.policyTurns} offline` : 'hard cap per meeting'} />
      <Tile label="Tokens in" value={num(t.promptTokens)} sub={t.llmCalls ? `${num(t.promptTokens / t.llmCalls)} per call` : 'none spent'} />
      <Tile label="Tokens out" value={num(t.completionTokens)} sub={t.reasoningTokens ? `+${num(t.reasoningTokens)} reasoning` : t.llmCalls ? (t.measured ? 'as billed' : 'estimated') : 'none spent'} />
      <Tile label="Latency" value={t.llmCalls ? secs(t.latencyMs / t.llmCalls) : '0 ms'} sub={t.llmCalls ? `slowest ${secs(t.maxLatencyMs)}` : 'no model call'} />
      <Tile
        label="Schema"
        value={validated ? `${t.schemaPass + t.schemaRepaired} / ${validated}` : 'n/a'}
        sub={validated ? `${t.schemaRepaired} repaired · ${t.schemaFail} failed` : 'offline turns are typed'}
        tone={t.schemaFail ? 'bad' : t.schemaRepaired ? 'warn' : validated ? 'good' : undefined}
      />
      <Tile label="Guardrails" value={t.guardrailFlags ? `${t.guardrailFlags} flag${t.guardrailFlags > 1 ? 's' : ''}` : 'clean'} sub={props.trace.verdict ? `verdict: ${props.trace.verdict.status}` : 'no verdict yet'} tone={props.trace.verdict?.status === 'overridden' ? 'bad' : t.guardrailFlags ? 'warn' : 'good'} />
    </div>
  );
}

function Triage(props: { trace: CouncilTrace }): JSX.Element {
  return (
    <table class="ins-table ins-triage">
      <tbody>
        {props.trace.triage.map((e) => {
          const m = MINISTER_BY_ID[e.ministry];
          return (
            <tr key={e.ministry} class={`role-${e.role}`} title={e.signals.map((s) => `${s.label} (${s.weight}/5)`).join('\n') || 'No signal: this issue does not touch the portfolio.'}>
              <td class="ins-agent">
                <i style={{ background: m.color }} />
                {m.short}
              </td>
              <td class="ins-bar-cell">
                <span class="ins-bar">
                  <i style={{ width: `${Math.round(e.urgency * 100)}%`, background: m.color }} />
                </span>
              </td>
              <td class="ins-numcell">{e.urgency.toFixed(2)}</td>
              <td>
                <span class={`ins-pill ${e.role === 'standby' ? 'off' : e.role === 'lead' ? 'live' : 'good'}`}>{e.role}</span>
              </td>
              <td class="ins-reason">{e.role === 'standby' && e.exposure === 0 ? e.kpi : e.reason}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Findings(props: { list: readonly Finding[] }): JSX.Element {
  return (
    <ul class="ins-findings">
      {props.list.map((f) => (
        <li key={f.check} class={f.passed ? 'ok' : f.strength === 'block' ? 'block' : 'warn'}>
          <span class="ins-mark" aria-hidden="true">
            {f.passed ? '✓' : f.strength === 'block' ? '✕' : '!'}
          </span>
          <div>
            <code>{f.check}</code>
            <div>{f.detail}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

type SpanTab = 'parsed' | 'raw' | 'prompt' | 'checks';

function SpanDetail(props: { span: AgentSpan }): JSX.Element {
  const { span } = props;
  const [tab, setTab] = useState<SpanTab>('parsed');
  const tabs: Array<[SpanTab, string]> = [
    ['parsed', 'Validated JSON'],
    ['raw', 'Raw reply'],
    ['prompt', 'Prompt'],
    ['checks', `Checks (${span.guardrails.filter((g) => !g.passed).length} flagged)`],
  ];
  return (
    <div class="ins-span-detail">
      <div class="ins-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button type="button" role="tab" key={id} aria-selected={tab === id} class={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {span.fallbackReason && <p class="ins-fallback">Stand-in answered: {span.fallbackReason}.</p>}
      {span.truncated && <p class="ins-fallback">The model ran out of output budget: the reply was cut off.</p>}
      {tab === 'parsed' && (
        <>
          <pre class="ins-json">{JSON.stringify(span.parsed, null, 2)}</pre>
          {span.repairs.length > 0 && <p class="ins-muted">Repaired by code: {span.repairs.join('; ')}.</p>}
          {span.schemaErrors.length > 0 && <p class="ins-bad">Schema errors: {span.schemaErrors.join('; ')}.</p>}
        </>
      )}
      {tab === 'raw' && <pre class="ins-json">{span.response || '(no model reply: the deterministic agent answered)'}</pre>}
      {tab === 'prompt' && (
        <>
          <div class="ins-prompt-label">system</div>
          <pre class="ins-json">{span.request.system}</pre>
          <div class="ins-prompt-label">user</div>
          <pre class="ins-json">{span.request.user}</pre>
        </>
      )}
      {tab === 'checks' && (span.guardrails.length ? <Findings list={span.guardrails} /> : <p class="ins-muted">The chair's recommendation is checked as a whole: see “Verdict guardrails”.</p>)}
    </div>
  );
}

const SOURCE_LABEL: Record<AgentSpan['source'], string> = { llm: 'LLM', cache: 'cache', policy: 'offline' };
const ROUND_LABEL: Record<number, string> = { 1: 'R1', 2: 'R2', 3: 'Chair' };

function Spans(props: { trace: CouncilTrace }): JSX.Element {
  const [open, setOpen] = useState<number | null>(null);
  const { spans } = props.trace;
  if (spans.length === 0) return <p class="ins-muted">No agent has been called yet. Triage, the options and their payloads above were all computed by code.</p>;
  return (
    <table class="ins-table ins-spans">
      <thead>
        <tr>
          <th>Agent</th>
          <th>Step</th>
          <th>Source</th>
          <th class="r">Latency</th>
          <th class="r">In</th>
          <th class="r">Out</th>
          <th>Schema</th>
          <th class="r">Flags</th>
        </tr>
      </thead>
      <tbody>
        {spans.map((s) => {
          const a = agentName(s.agent);
          const flags = s.guardrails.filter((g) => !g.passed).length;
          const isOpen = open === s.id;
          return [
            <tr key={s.id} class={`ins-span${isOpen ? ' is-open' : ''}`} onClick={() => setOpen(isOpen ? null : s.id)} tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpen(isOpen ? null : s.id)} aria-expanded={isOpen} title={s.provider}>
              <td class="ins-agent">
                <i style={{ background: a.color }} />
                {a.short}
              </td>
              <td>{ROUND_LABEL[s.round]}</td>
              <td>
                <span class={`ins-pill ${s.source === 'llm' ? 'live' : s.source === 'cache' ? 'good' : 'off'}`}>{SOURCE_LABEL[s.source]}</span>
              </td>
              <td class="r">{s.source === 'llm' ? secs(s.latencyMs) : '—'}</td>
              <td class="r">{s.source === 'llm' ? num(s.usage.prompt) : '0'}</td>
              <td class="r">{s.source === 'llm' ? num(s.usage.completion) : '0'}</td>
              <td>
                <span class={`ins-schema is-${s.schema === 'n/a' ? 'na' : s.schema}`}>{s.schema === 'n/a' ? 'typed' : s.schema}</span>
              </td>
              <td class="r">{flags ? <span class="ins-warn">{flags}</span> : '0'}</td>
            </tr>,
            isOpen && (
              <tr key={`${s.id}-detail`} class="ins-span-row">
                <td colSpan={8}>
                  <SpanDetail span={s} />
                </td>
              </tr>
            ),
          ];
        })}
      </tbody>
    </table>
  );
}

/** The payload fields worth a line, in words a recruiter can read at a glance. */
function payloadRows(e: StateDelta): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['budgetDelta', usd(e.budgetDelta)],
    ['hourlyNetDelta', `${usd(e.hourlyNetDelta)}/hr`],
  ];
  if (e.taxRateDelta.some((d) => d !== 0)) rows.push(['taxRateDelta', `[${e.taxRateDelta.join(', ')}] pts`]);
  if (e.debtDelta) rows.push(['debtDelta', usd(e.debtDelta)]);
  if (e.powerSupplyDelta) rows.push(['powerSupplyDelta', `${e.powerSupplyDelta} MW`]);
  if (e.waterSupplyDelta) rows.push(['waterSupplyDelta', num(e.waterSupplyDelta)]);
  if (e.residentsDisplaced) rows.push(['residentsDisplaced', num(e.residentsDisplaced)]);
  if (e.jobsLost) rows.push(['jobsLost', num(e.jobsLost)]);
  if (e.roadLengthDelta) rows.push(['roadLengthDelta', `${e.roadLengthDelta} m`]);
  if (e.trafficImpact.capacityDelta) rows.push(['trafficImpact.capacityDelta', `${e.trafficImpact.capacityDelta} vehicles`]);
  if (e.trafficImpact.rushPeakFactor !== 1) rows.push(['trafficImpact.rushPeakFactor', `×${e.trafficImpact.rushPeakFactor}`]);
  if (e.approvalDelta) rows.push(['approvalDelta', `${e.approvalDelta > 0 ? '+' : ''}${e.approvalDelta} pts`]);
  return rows;
}

function Payloads(props: { trace: CouncilTrace }): JSX.Element {
  const [json, setJson] = useState<string | null>(null);
  const chosen = props.trace.attribution?.chosen;
  const recommended = props.trace.verdict?.option;
  return (
    <div class="ins-payloads">
      {props.trace.options.map((o) => (
        <div key={o.id} class={`ins-payload${o.id === recommended ? ' is-rec' : ''}`}>
          <div class="ins-payload-head">
            <span class="ins-letter">{o.id}</span>
            <span class="ins-payload-title">{o.title}</span>
            {o.id === recommended && <span class="ins-pill live">recommended</span>}
            {o.id === chosen && <span class="ins-pill good">approved</span>}
            <span class={`ins-pill ${o.feasibility.status === 'ok' ? 'off' : o.feasibility.status === 'needs_loan' ? 'warn' : 'bad'}`}>{o.feasibility.status.replace('_', ' ')}</span>
            <button type="button" class="ins-link" onClick={() => setJson(json === o.id ? null : o.id)}>
              {json === o.id ? 'fields' : 'JSON'}
            </button>
          </div>
          {json === o.id ? (
            <pre class="ins-json">{JSON.stringify({ effects: o.effects, feasibility: o.feasibility }, null, 2)}</pre>
          ) : (
            <dl class="ins-kv">
              {payloadRows(o.effects).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ))}
    </div>
  );
}

function Outcome(props: { trace: CouncilTrace }): JSX.Element | null {
  const { attribution: a, execution: x } = props.trace;
  if (!a && !x) return <p class="ins-muted">Waiting for the mayor. Nothing changes in the city until an option is approved.</p>;
  return (
    <div>
      {a && (
        <dl class="ins-kv wide">
          <div>
            <dt>Mayor chose</dt>
            <dd>
              option {a.chosen} {a.recommended ? (a.followedChair ? '(as recommended)' : `(overruled the chair's ${a.recommended})`) : ''}
            </dd>
          </div>
          <div>
            <dt>First proposed by</dt>
            <dd>{a.proposedBy ? MINISTER_BY_ID[a.proposedBy].short : 'no minister: the mayor’s own pick'}</dd>
          </div>
          <div>
            <dt>Backed at the end by</dt>
            <dd>{a.backers.length ? a.backers.map((m) => MINISTER_BY_ID[m].short).join(', ') : 'nobody'}</dd>
          </div>
        </dl>
      )}
      {x && (
        <p class={x.ok ? (x.drift.length ? 'ins-warn-line' : 'ins-good-line') : 'ins-bad'}>
          {x.ok
            ? x.drift.length
              ? `Executed, but ${x.drift.length} field(s) differ from the payload: ${x.drift.map((d) => `${d.field} projected ${d.projected}, observed ${d.observed}`).join('; ')}.`
              : 'Executed as one transaction. Every immediate field of the payload matched the city afterwards.'
            : `Refused at ${x.stage}: ${x.reason ?? 'refused'}. ${x.stage === 'preflight' ? 'The city was not touched.' : ''}`}
        </p>
      )}
    </div>
  );
}

function Lifetime(): JSX.Element {
  const s = ui.aiStats.value;
  const validated = s.schemaPass + s.schemaRepaired + s.schemaFail;
  const rows: Array<[string, string]> = [
    ['Meetings', num(s.meetings)],
    ['Model calls', `${num(s.llmCalls)}${s.meetings ? ` (${(s.llmCalls / s.meetings).toFixed(1)} per meeting)` : ''}`],
    ['Tokens in / out', `${num(s.promptTokens)} / ${num(s.completionTokens)}`],
    ['Schema pass rate', validated ? `${Math.round((s.schemaPass / validated) * 100)}% first time, ${Math.round(((s.schemaPass + s.schemaRepaired) / validated) * 100)}% after repair` : 'n/a'],
    ['Turns answered offline', num(s.policyTurns)],
    ['Cache hits', num(s.cacheHits)],
    ['Figures verified in the facts shown', s.figuresQuoted ? `${num(s.figuresVerified)} of ${num(s.figuresQuoted)} (${Math.round((s.figuresVerified / s.figuresQuoted) * 100)}%)` : 'n/a'],
    ['Meetings that needed round 2', s.meetings ? `${s.contested} of ${s.meetings}` : 'n/a'],
    ['Guardrail overrides', num(s.overrides)],
    ['Mayor followed the chair', s.decisions ? `${s.followedChair} of ${s.decisions}` : 'n/a'],
    ['Assistant questions', s.assistantCalls ? `${num(s.assistantCalls)} (${num(s.assistantTokens)} tokens)` : '0'],
  ];
  return (
    <dl class="ins-kv wide">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The assistant's recent questions: the second model feature, on the same instruments. */
function AssistantCalls(): JSX.Element {
  const calls = ui.assistantCalls.value;
  if (calls.length === 0) return <p class="ins-muted">No question asked yet this session. Each one is listed here with the manual sections sent, its cost, and any figure code could not verify.</p>;
  return (
    <table class="ins-table ins-spans">
      <thead>
        <tr>
          <th>Question</th>
          <th>Source</th>
          <th class="r">Latency</th>
          <th class="r">In</th>
          <th class="r">Out</th>
          <th>Schema</th>
          <th class="r">Flags</th>
        </tr>
      </thead>
      <tbody>
        {calls.map((c) => (
          <tr key={c.id} title={`${c.question}\nManual sections sent: ${c.sections.join(', ')}\n${c.provider}${c.repairs.length ? `\nRepaired: ${c.repairs.join('; ')}` : ''}`}>
            <td class="ins-question">{c.question}</td>
            <td>
              <span class={`ins-pill ${c.source === 'llm' ? 'live' : 'off'}`}>{c.source === 'llm' ? 'LLM' : 'offline'}</span>
            </td>
            <td class="r">{c.promptTokens ? secs(c.latencyMs) : '—'}</td>
            <td class="r">{num(c.promptTokens)}</td>
            <td class="r">{num(c.completionTokens)}</td>
            <td>
              <span class={`ins-schema is-${c.schema === 'n/a' ? 'na' : c.schema}`}>{c.schema === 'n/a' ? 'rules' : c.schema}</span>
            </td>
            <td class="r">{c.unverified.length ? <span class="ins-warn">{c.unverified.length}</span> : '0'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Saves a trace as a file: the raw evidence behind everything on this panel. */
function exportTrace(trace: CouncilTrace): void {
  const blob = new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `council-trace-day-${trace.day}-${trace.issue.kind}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Inspector(): JSX.Element | null {
  const [pick, setPick] = useState<string | null>(null);
  if (!ui.inspector.value) return null;
  const live = ui.trace.value;
  const history = ui.traces.value;
  // In a meeting the live trace is shown; outside one, any of the last few can be picked.
  const inMeeting = ui.council.value !== null;
  const trace = (!inMeeting && pick ? history.find((t) => t.id === pick) : null) ?? live ?? history[0] ?? null;
  return (
    <aside class={`panel inspector${inMeeting ? ' in-chamber' : ''}`} aria-label="AI inspector">
      <header class="ins-head">
        <div>
          <div class="label">AI inspector · zero-token telemetry</div>
          <h2>{trace ? trace.issue.title : 'No meeting yet'}</h2>
        </div>
        <div class="ins-head-side">
          {trace && <span class={`ins-pill ${trace.mode === 'live' ? 'live' : 'off'}`}>{trace.mode === 'live' ? 'live AI' : 'offline'}</span>}
          {trace && (
            <button type="button" class="ins-link" title="Download this meeting's full trace as JSON" onClick={() => exportTrace(trace)}>
              Export
            </button>
          )}
          <button type="button" class="icon-btn" aria-label="Close the inspector" title="Close (I)" onClick={() => actions.toggleInspector()}>
            ×
          </button>
        </div>
      </header>
      <div class="ins-body">
        {!trace && <p class="ins-muted">Call the council on any problem and this panel fills in as the agents work: the pipeline state, each agent’s prompt and JSON reply, latency, tokens, schema results and guardrail checks.</p>}
        {!inMeeting && history.length > 1 && trace && (
          <label class="ins-history">
            <span class="label">Meeting</span>
            <select value={trace.id} onChange={(e) => setPick((e.target as HTMLSelectElement).value)}>
              {history.map((t) => (
                <option value={t.id} key={t.id}>
                  Day {t.day}: {t.issue.title} ({t.mode})
                </option>
              ))}
            </select>
          </label>
        )}
        {trace && (
          <>
            <Section title="Pipeline" note="state machine">
              <Pipeline trace={trace} />
            </Section>
            <Section title="This meeting" note={trace.totals.llmCalls ? (trace.totals.measured ? 'tokens as billed by the provider' : 'tokens estimated at 4 chars each') : 'no model called'}>
              <Totals trace={trace} />
            </Section>
            <Section title="Department triage" note="urgency = 0.75 exposure + 0.25 stress">
              <Triage trace={trace} />
            </Section>
            <Section title="Agent turns" note="click a row for its JSON and prompt">
              <Spans trace={trace} />
            </Section>
            <Section title="Option payloads" note="measured on a fork of the city">
              <Payloads trace={trace} />
            </Section>
            {trace.verdict && (
              <Section title="Verdict guardrails" note={trace.verdict.status}>
                {trace.verdict.overrideReason ? <p class="ins-bad">{trace.verdict.overrideReason}</p> : null}
                <Findings list={trace.verdict.findings} />
              </Section>
            )}
            <Section title="Mayor’s decision" note="human in the loop">
              <Outcome trace={trace} />
            </Section>
            {trace.constraints && trace.constraints.length > 0 && (
              <Section title="Mayor’s instruction" note="parsed and enforced by code">
                <ul class="ins-memory">
                  {trace.constraints.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </Section>
            )}
            <Section title="Episodic memory" note={`${trace.memory.length} line${trace.memory.length === 1 ? '' : 's'} injected`}>
              {trace.memory.length ? (
                <ul class="ins-memory">
                  {trace.memory.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              ) : (
                <p class="ins-muted">No earlier decision in this city is relevant to this problem. Decisions are remembered once the mayor approves one.</p>
              )}
            </Section>
          </>
        )}
        <Section title="Assistant" note="keyword-routed manual, same checks">
          <AssistantCalls />
        </Section>
        <Section title="All meetings" note="kept across reloads">
          <Lifetime />
        </Section>
      </div>
    </aside>
  );
}
