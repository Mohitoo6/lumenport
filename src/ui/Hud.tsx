import { render, type JSX } from 'preact';
import type { Speed } from '../sim/state';
import { IconAvenue, IconBulldoze, IconClose, IconCurve, IconFast, IconFaster, IconHelp, IconPause, IconPlay, IconRoad, IconStraight } from './icons';
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
  [['Esc'], 'Cancel tool'],
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

function ToolButton(props: { active: boolean; label: string; hotkey?: string; onClick: () => void; children: JSX.Element; danger?: boolean }): JSX.Element {
  return (
    <button
      type="button"
      class={`tool-btn${props.active ? ' is-active' : ''}${props.danger ? ' is-danger' : ''}`}
      aria-pressed={props.active}
      title={props.hotkey ? `${props.label} (${props.hotkey})` : props.label}
      onClick={props.onClick}
    >
      {props.children}
      <span>{props.label}</span>
    </button>
  );
}

function Toolbar(): JSX.Element {
  const tool = ui.tool.value;
  const road = ui.roadType.value;
  const mode = ui.roadMode.value;
  const hint = ui.hint.value;
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
      <nav class="panel toolbar" aria-label="Build tools">
        <ToolButton active={tool === 'road' && road === 0} label="Street" onClick={() => (tool === 'road' && road === 0 ? actions.selectTool('none') : actions.setRoadType(0))}>
          <IconRoad size={18} />
        </ToolButton>
        <ToolButton active={tool === 'road' && road === 1} label="Avenue" onClick={() => (tool === 'road' && road === 1 ? actions.selectTool('none') : actions.setRoadType(1))}>
          <IconAvenue size={18} />
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
      <Toolbar />
      <Help />
      <DevOverlay />
      <Loading />
    </>
  );
}

export function mountHud(root: HTMLElement): void {
  render(<Hud />, root);
}
