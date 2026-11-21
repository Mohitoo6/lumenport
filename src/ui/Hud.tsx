import { render, type JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { aiStatus } from '../game/council/llm';
import { LOAN_TIERS, loanPayment } from '../sim/economy/budget';
import { OVERLAYS } from '../render/overlays/dataOverlay';
import { CitizenFeed, CouncilChamber, IssuesMenu, MinisterRequestCard } from './council/Council';
import { Inspector } from './council/Inspector';
import { AssistantButton, AssistantPanel } from './assistant/Assistant';
import { CAMPUS_FACILITIES, FACILITIES, FacilityKind, POWER_FACILITIES, SERVICE_FACILITIES, TRANSIT_FACILITIES, WATER_FACILITIES } from '../sim/facilities';
import type { Speed } from '../sim/state';
import {
  IconAvenue,
  IconBolt,
  IconBulldoze,
  IconClose,
  IconCurve,
  IconDrop,
  IconErase,
  IconFactory,
  IconFast,
  IconFaster,
  IconHelp,
  IconHome,
  IconLayers,
  IconMenu,
  IconMist,
  IconMoon,
  IconRain,
  IconPause,
  IconPlay,
  IconRoad,
  IconShield,
  IconShop,
  IconStraight,
  IconSun,
  IconWarn,
} from './icons';
import { actions, saveScrollMode, ui } from './store';
import { QUALITY, type QualityId } from '../render/quality';

const QUALITY_NOTE: Record<QualityId, string> = {
  saver: 'Lowest heat and battery use: 30 frames a second, lower resolution, simpler shading.',
  balanced: 'Full detail while you play; fewer frames while the view is still. Recommended for laptops.',
  high: 'Full detail at all times. Best on desktops or laptops with a fan.',
};

const SPEEDS: Array<{ speed: Speed; label: string; icon: () => JSX.Element; key: string }> = [
  { speed: 0, label: 'Pause', icon: () => <IconPause />, key: 'Space' },
  { speed: 1, label: 'Normal speed: a game hour takes a minute', icon: () => <IconPlay />, key: '1' },
  { speed: 2, label: 'Fast: twice as quick', icon: () => <IconFast />, key: '2' },
  { speed: 3, label: 'Fastest: four times as quick, a day in six minutes', icon: () => <IconFaster />, key: '3' },
];

const TIME_LABEL = { auto: 'Auto', day: 'Day', night: 'Night' } as const;

const usd = (n: number): string => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

function DemandBars(): JSX.Element {
  const d = ui.demand.value;
  const names = ['Residential', 'Commercial', 'Industrial'];
  return (
    <div class="demand" role="img" aria-label={`Demand: ${names.map((n, i) => `${n} ${Math.round(d[i]! * 100)}%`).join(', ')}`}>
      {d.map((v, i) => (
        <div class={`demand-bar ${ZONE_CLASS[i + 1]}`} key={i} title={`${names[i]} demand ${Math.round(v * 100)}%`}>
          <span style={{ height: `${Math.abs(v) * 50}%`, [v >= 0 ? 'bottom' : 'top']: '50%' }} />
        </div>
      ))}
    </div>
  );
}

function Stats(): JSX.Element {
  const net = ui.budget.value.net;
  const sandbox = ui.sandbox.value;
  return (
    <div class="panel stats">
      <button type="button" class={`stat stat-btn${ui.showBudget.value ? ' is-open' : ''}`} title="Budget (B)" aria-expanded={ui.showBudget.value} onClick={() => (ui.showBudget.value = !ui.showBudget.value)}>
        <span class="label">Funds</span>
        <span class="stat-value">{sandbox ? 'Unlimited' : usd(ui.funds.value)}</span>
        {!sandbox && <span class={`stat-sub ${net >= 0 ? 'good' : 'bad'}`}>{`${net >= 0 ? '+' : ''}${usd(net)} / hour`}</span>}
      </button>
      <div class="stat">
        <span class="label">Population</span>
        <span class="stat-value">{ui.population.value.toLocaleString('en-US')}</span>
      </div>
      <div class="stat">
        <span class="label">Happiness</span>
        <span class={`stat-value ${ui.happiness.value >= 0.5 ? 'good' : 'bad'}`}>{`${Math.round(ui.happiness.value * 100)}%`}</span>
      </div>
      <div class="stat">
        <span class="label">Demand</span>
        <DemandBars />
      </div>
    </div>
  );
}

const money = (n: number): string => `$${n.toLocaleString('en-US')}`;

/** The goal being worked on: what to do, how far along, and the grant it pays. */
function GoalCard(): JSX.Element | null {
  const g = ui.goal.value;
  if (!g) return null;
  const share = g.target > 0 ? g.now / g.target : 0;
  const counted = g.target > 1;
  if (ui.goalCollapsed.value) {
    return (
      <button type="button" class="panel goal goal-mini" title={`${g.title}. ${g.hint}`} onClick={() => (ui.goalCollapsed.value = false)}>
        <span class="goal-step">
          Goal {g.index + 1}/{g.total}
        </span>
        <span class="goal-mini-title">{g.title}</span>
        <span class="goal-ring" style={{ background: `conic-gradient(var(--accent) ${Math.round(share * 100)}%, rgba(255, 255, 255, 0.15) 0)` }} aria-hidden="true" />
      </button>
    );
  }
  return (
    <section class="panel goal" aria-label="Current goal">
      <div class="goal-head">
        <span class="goal-step">
          Goal {g.index + 1} of {g.total}
        </span>
        {g.reward > 0 && <span class="goal-reward">+{money(g.reward)}</span>}
        <button type="button" class="icon-btn" aria-label="Minimise goal" title="Minimise" onClick={() => (ui.goalCollapsed.value = true)}>
          <IconClose size={11} />
        </button>
      </div>
      <div class="goal-title">{g.title}</div>
      <div class="goal-hint">{g.hint}</div>
      {counted && (
        <div class="goal-progress">
          <div class="goal-track">
            <span style={{ width: `${Math.min(100, share * 100)}%` }} />
          </div>
          <span class="goal-count">
            {g.now.toLocaleString('en-US')} / {g.target.toLocaleString('en-US')}
          </span>
        </div>
      )}
    </section>
  );
}

/** A short banner when a goal is reached. */
function GoalBanner(): JSX.Element | null {
  const b = ui.goalBanner.value;
  if (!b) return null;
  return (
    <div class="goal-banner" role="status">
      <div class="goal-banner-kicker">Goal reached</div>
      <div class="goal-banner-title">{b.title}</div>
      <div class="goal-banner-sub">
        {b.reward > 0 ? `City grant ${money(b.reward)}. ` : ''}
        {b.next ? `Next: ${b.next}` : 'Every goal is done: the city is yours.'}
      </div>
    </div>
  );
}

function Alerts(): JSX.Element | null {
  const list = ui.alerts.value;
  return (
    <div class="left-stack">
      <GoalCard />
      {list.length > 0 && (
        <ul class="alerts" aria-live="polite">
          {list.map((a) => (
            <li key={a}>
              <IconWarn size={13} />
              {a}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Meter(props: { label: string; supply: number; demand: number; unit: string }): JSX.Element {
  const { supply, demand } = props;
  const ratio = supply > 0 ? Math.min(1, demand / supply) : demand > 0 ? 1 : 0;
  const tone = supply === 0 || demand > supply ? 'bad' : ratio > 0.9 ? 'warn' : 'good';
  const fmt = (n: number): string => (n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(1));
  return (
    <div class="meter">
      <div class="meter-head">
        <span>{props.label}</span>
        <span class="muted">{`${fmt(demand)} / ${fmt(supply)} ${props.unit}`}</span>
      </div>
      <div class="meter-track">
        <span class={`tone-${tone}`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

function BudgetPanel(): JSX.Element | null {
  if (!ui.showBudget.value) return null;
  const b = ui.budget.value;
  const tax = ui.tax.value;
  const loans = ui.loans.value;
  const row = (label: string, value: number, sign: 1 | -1): JSX.Element => (
    <div class="ledger-row" key={label}>
      <span>{label}</span>
      <span class={value === 0 ? 'muted' : sign > 0 ? 'good' : 'bad'}>{value === 0 ? '$0' : `${sign > 0 ? '+' : '-'}${usd(value)}`}</span>
    </div>
  );
  const zones = ['Residential', 'Commercial', 'Industrial'];
  return (
    <aside class="panel budget" aria-label="Budget">
      <div class="panel-head">
        <h2>Budget</h2>
        <button type="button" class="icon-btn" aria-label="Close budget" onClick={() => (ui.showBudget.value = false)}>
          <IconClose size={12} />
        </button>
      </div>

      <section>
        <h3 class="label">Taxes</h3>
        {zones.map((z, i) => (
          <label class={`tax ${ZONE_CLASS[i + 1]}`} key={z}>
            <span>{z}</span>
            <input type="range" min="0" max="20" step="1" value={tax[i]} onInput={(e) => actions.setTax(i + 1, Number((e.target as HTMLInputElement).value))} />
            <output>{tax[i]}%</output>
          </label>
        ))}
      </section>

      <section>
        <h3 class="label">This hour, as things stand</h3>
        {row('Residential tax', b.taxR, 1)}
        {row('Commercial tax', b.taxC, 1)}
        {row('Industrial tax', b.taxI, 1)}
        {(b.fares > 0 || b.transit > 0) && row('Transit fares', b.fares, 1)}
        {b.airport > 0 && row('Airport: trade, travel, tourists', b.airport, 1)}
        {row('Road upkeep', b.roads, -1)}
        {row('Utilities', b.utilities, -1)}
        {row('Services', b.services, -1)}
        {(b.fares > 0 || b.transit > 0) && row('Transit upkeep', b.transit, -1)}
        {row('Loan payments', b.loans, -1)}
        <div class="ledger-row total">
          <span>Net</span>
          <span class={b.net >= 0 ? 'good' : 'bad'}>{`${b.net >= 0 ? '+' : ''}${usd(b.net)}`}</span>
        </div>
      </section>

      <section>
        <h3 class="label">Utilities</h3>
        <Meter label="Power" supply={ui.power.value[0]} demand={ui.power.value[1]} unit="MW" />
        <Meter label="Water" supply={ui.water.value[0]} demand={ui.water.value[1]} unit="units" />
      </section>

      <section>
        <h3 class="label">Loans</h3>
        {LOAN_TIERS.map((t, i) => {
          const taken = loans.find((l) => l.tier === i);
          return (
            <div class="loan" key={i}>
              <div>
                <div>{usd(t.amount)}</div>
                <div class="muted">{taken ? `${taken.hoursLeft} payments of ${usd(taken.payment)} left` : `${usd(loanPayment(t))} an hour for ${t.hours} hours`}</div>
              </div>
              <button type="button" class="btn" disabled={!!taken} onClick={() => actions.takeLoan(i)}>
                {taken ? 'Active' : 'Borrow'}
              </button>
            </div>
          );
        })}
      </section>
    </aside>
  );
}

function Views(): JSX.Element {
  const current = OVERLAYS.find((o) => o.id === ui.overlay.value)!;
  const open = ui.showViews.value;
  return (
    <div class="views">
      <button type="button" class={`panel views-btn${current.id !== 'none' ? ' is-on' : ''}`} aria-expanded={open} title="Data views (V)" onClick={() => (ui.showViews.value = !open)}>
        <IconLayers />
        <span>{current.id === 'none' ? 'Views' : current.name}</span>
      </button>
      {current.id !== 'none' && (
        <div class="panel legend" aria-label={`${current.name} legend`}>
          <span>{current.low}</span>
          <i style={{ background: current.gradient }} />
          <span>{current.high}</span>
        </div>
      )}
      {open && (
        <div class="panel views-menu" role="menu">
          {OVERLAYS.map((o) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={o.id === current.id}
              class={o.id === current.id ? 'is-active' : ''}
              key={o.id}
              onClick={() => {
                actions.setOverlay(o.id);
                ui.showViews.value = false;
              }}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const SLOTS: Array<[id: string, name: string]> = [
  ['autosave', 'Autosave'],
  ['slot1', 'Slot 1'],
  ['slot2', 'Slot 2'],
  ['slot3', 'Slot 3'],
];

function Menu(): JSX.Element | null {
  const [seed, setSeed] = useState('');
  const [sandbox, setSandbox] = useState(false);
  if (!ui.showMenu.value) return null;
  const saved = ui.saves.value;
  const when = (ms: number): string => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <aside class="panel menu" aria-label="Menu">
      <div class="panel-head">
        <h2>Menu</h2>
        <button type="button" class="icon-btn" aria-label="Close menu" onClick={() => (ui.showMenu.value = false)}>
          <IconClose size={12} />
        </button>
      </div>

      <section>
        <h3 class="label">Saved cities</h3>
        {SLOTS.map(([id, name]) => {
          const meta = saved.find((m) => m.slot === id);
          return (
            <div class="loan" key={id}>
              <div>
                <div>{meta ? `${name}: ${meta.cityName}` : name}</div>
                <div class="muted">{meta ? `${meta.population.toLocaleString('en-US')} residents, saved ${when(meta.savedAt)}` : 'Empty'}</div>
              </div>
              <div class="btn-row">
                {id !== 'autosave' && (
                  <button type="button" class="btn" onClick={() => actions.save(id)}>
                    Save
                  </button>
                )}
                <button type="button" class="btn" disabled={!meta} onClick={() => actions.load(id)}>
                  Load
                </button>
              </div>
            </div>
          );
        })}
        <p class="muted menu-note">The city is also saved automatically every two minutes.</p>
      </section>

      <section>
        <h3 class="label">New city</h3>
        <label class="field">
          <span>Map seed</span>
          <input type="text" inputMode="numeric" placeholder="Random" value={seed} onInput={(e) => setSeed((e.target as HTMLInputElement).value.replace(/[^0-9]/g, '').slice(0, 9))} />
        </label>
        <label class="check">
          <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox((e.target as HTMLInputElement).checked)} />
          <span>Sandbox: unlimited money, no utilities needed</span>
        </label>
        <button type="button" class="btn btn-wide" onClick={() => actions.newCity(seed ? Number(seed) : Math.floor(Math.random() * 1e9), sandbox)}>
          Start new city
        </button>
      </section>

      <section>
        <h3 class="label">Graphics</h3>
        <div class="seg seg-wide" role="group" aria-label="Graphics quality">
          {(Object.values(QUALITY) as Array<(typeof QUALITY)[keyof typeof QUALITY]>).map((q) => (
            <button type="button" key={q.id} class={ui.quality.value === q.id ? 'is-on' : ''} aria-pressed={ui.quality.value === q.id} onClick={() => actions.setQuality(q.id)}>
              {q.label}
            </button>
          ))}
        </div>
        <p class="muted menu-note">{QUALITY_NOTE[ui.quality.value]}</p>
      </section>

      <section>
        <h3 class="label">Scroll (trackpad or wheel)</h3>
        <div class="seg seg-wide" role="group" aria-label="What scrolling does">
          {(
            [
              ['auto', 'Auto'],
              ['pan', 'Move map'],
              ['zoom', 'Zoom'],
            ] as const
          ).map(([id, label]) => (
            <button type="button" key={id} class={ui.scrollMode.value === id ? 'is-on' : ''} aria-pressed={ui.scrollMode.value === id} onClick={() => saveScrollMode(id)}>
              {label}
            </button>
          ))}
        </div>
        <p class="muted menu-note">
          {ui.scrollMode.value === 'auto'
            ? 'Two-finger swipe moves the map, pinch zooms; a mouse wheel zooms.'
            : ui.scrollMode.value === 'pan'
              ? 'Scrolling moves the map; pinch (or Ctrl + scroll) zooms.'
              : 'Scrolling always zooms; drag the map to move it.'}
        </p>
      </section>

      <section>
        <label class="check">
          <input type="checkbox" checked={!ui.muted.value} onChange={(e) => actions.setMuted(!(e.target as HTMLInputElement).checked)} />
          <span>Sound</span>
        </label>
      </section>
      {ui.menuNote.value && (
        <p class="menu-status" role="status">
          {ui.menuNote.value}
        </p>
      )}
    </aside>
  );
}

function Inspect(): JSX.Element | null {
  const d = ui.inspect.value;
  if (!d) return null;
  return (
    <aside class="panel inspect" aria-label="Selected building">
      <div class="panel-head">
        <h2>{d.title}</h2>
        <button type="button" class="icon-btn" aria-label="Close" onClick={() => actions.closeInspect()}>
          <IconClose size={12} />
        </button>
      </div>
      <div class="muted inspect-sub">{d.subtitle}</div>
      {d.rows.map(([label, value, tone]) => (
        <div class="ledger-row" key={label + value}>
          <span class="muted">{label}</span>
          <span class={tone ?? ''}>{value}</span>
        </div>
      ))}
    </aside>
  );
}

/** The season and the weather it has brought, with what that does to the city. */
function Weather(): JSX.Element {
  const w = ui.weather.value;
  const raining = w.rain > 0.12;
  const misty = w.mist > 0.3;
  const state = raining ? (w.rain > 0.6 ? 'Heavy rain' : 'Rain') : misty ? 'Mist' : ui.isNight.value ? 'Clear night' : 'Clear';
  return (
    <div class="panel weather" title={`${w.english}. ${w.effect}`} aria-label={`${w.english}, ${w.temperature} degrees, ${state.toLowerCase()}`}>
      {raining ? <IconRain /> : misty ? <IconMist /> : ui.isNight.value ? <IconMoon /> : <IconSun />}
      <span class="weather-text">
        <span class="weather-season">{w.english}</span>
        <span class="weather-now">
          {w.temperature}° {state.toLowerCase()}
        </span>
      </span>
    </div>
  );
}

function TopBar(): JSX.Element {
  return (
    <header class="topbar">
      <div class="panel city">
        <div class="city-name">{ui.cityName.value}</div>
        <div class="city-date">{ui.dateLabel.value}</div>
      </div>
      <div class="panel speed" role="group" aria-label="Game speed">
        {SPEEDS.map((s) => (
          <button
            key={s.speed}
            type="button"
            class={`speed-btn${ui.speed.value === s.speed ? ' is-active' : ''}`}
            title={`${s.label} (${s.key})`}
            aria-label={s.label}
            aria-pressed={ui.speed.value === s.speed}
            onClick={() => actions.setSpeed(s.speed)}
          >
            {s.icon()}
          </button>
        ))}
      </div>
      <Stats />
      <button type="button" class="panel clock" title={`The city's time of day. Light: ${TIME_LABEL[ui.timeMode.value]}. Click to keep daylight or night on screen; the clock and the traffic keep their real time.`} onClick={() => actions.cycleTimeMode()}>
        {ui.isNight.value ? <IconMoon /> : <IconSun />}
        <span class="clock-time">{ui.clock.value}</span>
        <span class="label">{TIME_LABEL[ui.timeMode.value]}</span>
      </button>
      <Weather />
      <IssuesMenu />
      <AssistantButton />
      <Views />
      <button
        type="button"
        class={`panel menu-btn${ui.showMenu.value ? ' is-on' : ''}`}
        aria-label="Menu"
        aria-expanded={ui.showMenu.value}
        title="Menu (M)"
        onClick={() => {
          ui.showMenu.value = !ui.showMenu.value;
          if (ui.showMenu.value) actions.refreshSaves();
        }}
      >
        <IconMenu />
      </button>
    </header>
  );
}

const HELP: Array<[string[], string]> = [
  [['Drag'], 'Move the map'],
  [['2-finger swipe'], 'Move (trackpad)'],
  [['Pinch', 'Wheel'], 'Zoom'],
  [['W', 'A', 'S', 'D'], 'Move'],
  [['Q', 'E'], 'Rotate'],
  [['R', 'F'], 'Tilt'],
  [['Right-drag'], 'Orbit'],
  [['Esc'], 'Cancel tool'],
  [['B'], 'Budget'],
  [['V'], 'Data views'],
  [['M'], 'Menu, save and load'],
  [['I'], 'AI inspector'],
];

function Help(): JSX.Element {
  if (!ui.showHelp.value) {
    return (
      <button type="button" class="panel help-toggle" aria-label="Show camera controls" title="Camera controls" onClick={() => (ui.showHelp.value = true)}>
        <IconHelp />
      </button>
    );
  }
  return (
    <aside class="panel help">
      <div class="help-head">
        <span class="label">Camera</span>
        <button type="button" class="icon-btn" aria-label="Hide camera controls" onClick={() => (ui.showHelp.value = false)}>
          <IconClose size={12} />
        </button>
      </div>
      <dl>
        {HELP.map(([keys, what]) => (
          <div class="help-row" key={what}>
            <dt>
              {keys.map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

const ZONE_CLASS = ['', 'zone-r', 'zone-c', 'zone-i'];
const DENSITIES = ['Low', 'Medium', 'High'];

function ToolButton(props: { active: boolean; label: string; hotkey?: string; onClick: () => void; children: JSX.Element; danger?: boolean; tone?: string }): JSX.Element {
  return (
    <button
      type="button"
      class={`tool-btn${props.active ? ' is-active' : ''}${props.danger ? ' is-danger' : ''}${props.tone ? ` ${props.tone}` : ''}`}
      aria-pressed={props.active}
      title={props.hotkey ? `${props.label} (${props.hotkey})` : props.label}
      onClick={props.onClick}
    >
      {props.children}
      <span>{props.label}</span>
    </button>
  );
}

function IconTrain(props: { size?: number }): JSX.Element {
  const s = props.size ?? 18;
  return (
    <svg width={s} height={s} viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="4" y="2.5" width="10" height="10" rx="2.2" />
      <path d="M4 8h10M6.5 15.5l1.5-3M11.5 15.5l-1.5-3" />
      <circle cx="6.8" cy="10.3" r="0.6" fill="currentColor" />
      <circle cx="11.2" cy="10.3" r="0.6" fill="currentColor" />
    </svg>
  );
}

function IconCampus(props: { size?: number }): JSX.Element {
  const s = props.size ?? 18;
  return (
    <svg width={s} height={s} viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M2.5 15.5h13M4 15.5V8.5h3.5v7M10.5 15.5V3h3.5v12.5M5.5 11h.5M12 6h.5M12 9h.5M12 12h.5" />
    </svg>
  );
}

function IconSquare(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.4 1.8" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
    </svg>
  );
}

function Toolbar(): JSX.Element {
  const tool = ui.tool.value;
  const road = ui.roadType.value;
  const mode = ui.roadMode.value;
  const hint = ui.hint.value;
  const zt = ui.zoneType.value;
  const zd = ui.zoneDensity.value;
  const fk = ui.facility.value;
  const group: readonly number[] = POWER_FACILITIES.includes(fk as never)
    ? POWER_FACILITIES
    : WATER_FACILITIES.includes(fk as never)
      ? WATER_FACILITIES
      : CAMPUS_FACILITIES.includes(fk as never)
        ? CAMPUS_FACILITIES
        : TRANSIT_FACILITIES.includes(fk as never)
          ? TRANSIT_FACILITIES
          : SERVICE_FACILITIES;
  const isPower = group === POWER_FACILITIES;
  const isWater = group === WATER_FACILITIES;
  const isService = group === SERVICE_FACILITIES;
  const isCampus = group === CAMPUS_FACILITIES;
  const isMetro = tool === 'metro' || (tool === 'place' && group === TRANSIT_FACILITIES);
  const zoneBtn = (type: number, label: string, icon: JSX.Element): JSX.Element => (
    <ToolButton
      tone={ZONE_CLASS[type]}
      active={tool === 'zone' && zt === type}
      label={label}
      onClick={() => (tool === 'zone' && zt === type ? actions.selectTool('none') : actions.setZone(type, type === 0 ? 1 : zd))}
    >
      {icon}
    </ToolButton>
  );
  return (
    <div class="dock">
      {hint && (
        <div class={`hint tone-${hint.tone}`} role="status">
          {hint.text}
        </div>
      )}
      {tool === 'road' && (
        <div class="panel options" role="group" aria-label="Road shape">
          <ToolButton active={mode === 'straight'} label="Straight" hotkey="C" onClick={() => actions.setRoadMode('straight')}>
            <IconStraight />
          </ToolButton>
          <ToolButton active={mode === 'curve'} label="Curved" hotkey="C" onClick={() => actions.setRoadMode('curve')}>
            <IconCurve />
          </ToolButton>
        </div>
      )}
      {tool === 'zone' && (
        <div class="panel options" role="group" aria-label="Zone brush">
          <ToolButton active={ui.zoneMode.value === 'road'} label="Along road" onClick={() => actions.setZoneMode('road')}>
            <IconCurve />
          </ToolButton>
          <ToolButton active={ui.zoneMode.value === 'area'} label="Area" onClick={() => actions.setZoneMode('area')}>
            <IconSquare />
          </ToolButton>
        </div>
      )}
      {tool === 'zone' && zt !== 0 && (
        <div class="panel options" role="group" aria-label="Density">
          {DENSITIES.map((name, i) => (
            <ToolButton key={name} tone={ZONE_CLASS[zt]} active={zd === i + 1} label={`${name} density`} onClick={() => actions.setZone(zt, i + 1)}>
              <span class={`density-pips d${i + 1}`} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </ToolButton>
          ))}
        </div>
      )}
      {isMetro && (
        <div class="panel options" role="group" aria-label="Transit">
          <ToolButton active={tool === 'place' && fk === FacilityKind.BusStop} label={`Bus stop · ${usd(FACILITIES[FacilityKind.BusStop]!.cost)}`} onClick={() => actions.setFacility(FacilityKind.BusStop)}>
            <span class="opt-dot" aria-hidden="true" />
          </ToolButton>
          <ToolButton active={tool === 'place' && fk === FacilityKind.MetroStation} label={`Metro station · ${usd(FACILITIES[FacilityKind.MetroStation]!.cost)}`} onClick={() => actions.setFacility(FacilityKind.MetroStation)}>
            <span class="opt-dot" aria-hidden="true" />
          </ToolButton>
          <ToolButton active={tool === 'metro'} label="Metro line · $30 / m" onClick={() => actions.selectTool('metro')}>
            <span class="opt-dot" aria-hidden="true" />
          </ToolButton>
          <ToolButton active={tool === 'place' && fk === FacilityKind.Airport} label={`Airport · ${usd(FACILITIES[FacilityKind.Airport]!.cost)}`} onClick={() => actions.setFacility(FacilityKind.Airport)}>
            <span class="opt-dot" aria-hidden="true" />
          </ToolButton>
        </div>
      )}
      {tool === 'place' && !isMetro && (
        <div class="panel options" role="group" aria-label="Facility">
          {group.map((k) => (
            <ToolButton key={k} active={fk === k} label={`${FACILITIES[k]!.name} · ${usd(FACILITIES[k]!.cost)}`} onClick={() => actions.setFacility(k)}>
              <span class="opt-dot" aria-hidden="true" />
            </ToolButton>
          ))}
        </div>
      )}
      <nav class="panel toolbar" aria-label="Build tools">
        <ToolButton active={tool === 'road' && road === 0} label="Street" onClick={() => (tool === 'road' && road === 0 ? actions.selectTool('none') : actions.setRoadType(0))}>
          <IconRoad size={18} />
        </ToolButton>
        <ToolButton active={tool === 'road' && road === 1} label="Avenue" onClick={() => (tool === 'road' && road === 1 ? actions.selectTool('none') : actions.setRoadType(1))}>
          <IconAvenue size={18} />
        </ToolButton>
        <div class="toolbar-sep" />
        {zoneBtn(1, 'Homes', <IconHome size={18} />)}
        {zoneBtn(2, 'Shops', <IconShop size={18} />)}
        {zoneBtn(3, 'Industry', <IconFactory size={18} />)}
        {zoneBtn(0, 'De-zone', <IconErase size={18} />)}
        <div class="toolbar-sep" />
        <ToolButton active={tool === 'place' && isPower} label="Power" onClick={() => (tool === 'place' && isPower ? actions.selectTool('none') : actions.setFacility(POWER_FACILITIES[0]))}>
          <IconBolt size={18} />
        </ToolButton>
        <ToolButton active={tool === 'place' && isWater} label="Water" onClick={() => (tool === 'place' && isWater ? actions.selectTool('none') : actions.setFacility(WATER_FACILITIES[0]))}>
          <IconDrop size={18} />
        </ToolButton>
        <ToolButton active={tool === 'place' && isService} label="Services" onClick={() => (tool === 'place' && isService ? actions.selectTool('none') : actions.setFacility(SERVICE_FACILITIES[0]))}>
          <IconShield size={18} />
        </ToolButton>
        <ToolButton active={tool === 'place' && isCampus} label="Business" onClick={() => (tool === 'place' && isCampus ? actions.selectTool('none') : actions.setFacility(CAMPUS_FACILITIES[0]))}>
          <IconCampus size={18} />
        </ToolButton>
        <ToolButton active={isMetro} label="Transit" onClick={() => (isMetro ? actions.selectTool('none') : actions.setFacility(TRANSIT_FACILITIES[0]))}>
          <IconTrain size={18} />
        </ToolButton>
        <div class="toolbar-sep" />
        <ToolButton danger active={tool === 'bulldoze'} label="Bulldoze" hotkey="X" onClick={() => actions.selectTool(tool === 'bulldoze' ? 'none' : 'bulldoze')}>
          <IconBulldoze size={18} />
        </ToolButton>
      </nav>
    </div>
  );
}

function DevOverlay(): JSX.Element | null {
  if (!ui.showDev.value) return null;
  return <pre class="panel dev">{ui.devText.value}</pre>;
}

const WELCOME_KEY = 'metropolis.welcome.v1';

function seenWelcome(): boolean {
  try {
    return localStorage.getItem(WELCOME_KEY) === '1';
  } catch {
    return false;
  }
}

/** First visit only: what the game is, what the AI does, and where to start. */
function Welcome(): JSX.Element | null {
  const [open, setOpen] = useState(() => !document.body.classList.contains('shots') && !seenWelcome());
  const [ai, setAi] = useState<boolean | null>(null);
  useEffect(() => {
    if (open) void aiStatus().then((s) => setAi(s.ready));
  }, [open]);
  if (!open || ui.loading.value !== null) return null;
  const close = (): void => {
    try {
      localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      /* private window: show it again next time */
    }
    setOpen(false);
  };
  return (
    <div class="welcome-backdrop" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div class="panel welcome">
        <div class="welcome-kicker">A city builder with an AI council</div>
        <h1 id="welcome-title">Metropolis</h1>
        <ul class="welcome-points">
          <li>
            <strong>Build.</strong> Lay a street, zone homes, shops and industry, and keep power, water and services ahead of the people moving in. The goal card at the top left shows the next step.
          </li>
          <li>
            <strong>Govern.</strong> When something goes wrong, call the <em>Council</em>: ministers argue from your city's real numbers, code checks every figure and rule, and you make the call.
          </li>
          <li>
            <strong>Ask.</strong> Stuck? The assistant answers from your city's live data, in English or Hindi.
          </li>
        </ul>
        <div class="welcome-keys">
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> or drag to move · <kbd>Q</kbd>
          <kbd>E</kbd> rotate · scroll to zoom · <kbd>M</kbd> menu and saves
        </div>
        <div class="welcome-foot">
          <span class={`welcome-ai ${ai ? 'on' : 'off'}`}>
            {ai === null ? 'Checking the AI…' : ai ? 'AI connected: ministers speak through a language model.' : 'Offline AI: ministers use built-in rule-based agents, at no cost.'}
          </span>
          <button type="button" class="welcome-go" onClick={close}>
            Start building
          </button>
        </div>
      </div>
    </div>
  );
}

function Loading(): JSX.Element {
  const msg = ui.loading.value;
  return (
    <div class={`loading${msg === null ? ' is-done' : ''}`} aria-hidden={msg === null}>
      <div class="loading-inner">
        <div class="loading-title">Metropolis</div>
        <div class="loading-bar">
          <span />
        </div>
        <div class="loading-msg">{msg ?? 'Ready'}</div>
      </div>
    </div>
  );
}

function Hud(): JSX.Element {
  // While the council sits (and on the way in and out) the city's HUD steps aside.
  const city = ui.cinema.value === 'off';
  return (
    <>
      {city && (
        <>
          <TopBar />
          <Alerts />
          <GoalBanner />
          <BudgetPanel />
          <Menu />
          <Inspect />
          <MinisterRequestCard />
          <CitizenFeed />
          <AssistantPanel />
          <Toolbar />
          <Help />
          {/* Outside a meeting the inspector shows the last few meetings' traces. */}
          {!ui.council.value && <Inspector />}
        </>
      )}
      <CouncilChamber />
      <DevOverlay />
      <Loading />
      <Welcome />
    </>
  );
}

export function mountHud(root: HTMLElement): void {
  render(<Hud />, root);
}
