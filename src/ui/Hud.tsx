import { render, type JSX } from 'preact';
import type { Speed } from '../sim/state';
import { IconClose, IconFast, IconFaster, IconHelp, IconPause, IconPlay } from './icons';
import { actions, ui } from './store';

const SPEEDS: Array<{ speed: Speed; label: string; icon: () => JSX.Element; key: string }> = [
  { speed: 0, label: 'Pause', icon: () => <IconPause />, key: 'Space' },
  { speed: 1, label: 'Normal speed', icon: () => <IconPlay />, key: '1' },
  { speed: 2, label: 'Fast', icon: () => <IconFast />, key: '2' },
  { speed: 3, label: 'Fastest', icon: () => <IconFaster />, key: '3' },
];

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
    </header>
  );
}

const HELP: Array<[string[], string]> = [
  [['W', 'A', 'S', 'D'], 'Move'],
  [['Q', 'E'], 'Rotate'],
  [['R', 'F'], 'Tilt'],
  [['Scroll'], 'Zoom'],
  [['Right-drag'], 'Orbit'],
  [['Shift', 'Drag'], 'Grab'],
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

function DevOverlay(): JSX.Element | null {
  if (!ui.showDev.value) return null;
  return <pre class="panel dev">{ui.devText.value}</pre>;
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
  return (
    <>
      <TopBar />
      <Help />
      <DevOverlay />
      <Loading />
    </>
  );
}

export function mountHud(root: HTMLElement): void {
  render(<Hud />, root);
}
