import type { CameraPose } from '../render/camera/rtsCamera';
import type { Command, CommandResult } from '../sim/commands';
import { START_HOUR, TICKS_PER_HOUR } from '../core/constants';
import { skyAt, weatherAt } from '../sim/seasons';
import { ui } from '../ui/store';
import type { Game } from './Game';

/**
 * `window.__game`: a small scripting surface used by the Playwright screenshot runs and
 * handy in the console. Everything a script does goes through the same commands as the UI.
 */
export interface DebugApi {
  ready: boolean;
  game: Game;
  exec(cmd: Command): CommandResult;
  camera(pose: Partial<CameraPose>, instant?: boolean): void;
  /** Runs `n` simulation ticks immediately, regardless of game speed. */
  advance(n: number): void;
  /** Council controls for scripted runs. */
  council: {
    issues(): Array<{ key: string; kind: string; title: string; severity: number }>;
    convene(kind: string): boolean;
    /** Shows every statement already received at once. */
    skip(): void;
    /** The cinematic's phase: off, enter, inside or exit. */
    phase(): string;
    /** Seconds into the cinematic's current phase. */
    cineTime(): number;
    /** Opens or closes the AI inspector panel. */
    inspector(open: boolean): void;
    /** The current meeting's telemetry trace. */
    trace(): import('./council/telemetry').CouncilTrace | null;
  };
  /** Founds the town hall if there is none. */
  townHall(): boolean;
  /** Installs a game state (for tests of save and load). */
  loadState(state: import('../sim/state').GameState): void;
  /** Jumps to a time of day (hours) and holds the clock there. */
  time(hour: number): void;
  /** Shows the sky and weather of a point in the year: a month (0..11) and an hour of that day. Null follows the calendar. */
  season(month: number | null, hour?: number): void;
  /** Resolves after `n` rendered frames. */
  frames(n: number): Promise<void>;
  stats(): ReturnType<Game['stats']>;
}

declare global {
  interface Window {
    __game?: DebugApi;
  }
}

export function installDebugApi(game: Game): void {
  window.__game = {
    ready: true,
    game,
    exec: (cmd) => game.exec(cmd),
    camera: (pose, instant = true) => game.setCamera(pose, instant),
    time: (hour) => game.setTime(hour),
    season: (month, hour = 13) => {
      if (month === null) return game.setSky(null);
      // The tick at that hour of that month's day, in the city's first year.
      const tick = (month * 24 + hour - START_HOUR) * TICKS_PER_HOUR;
      game.setSky(skyAt(tick, game.sim.state.seed), weatherAt(tick, game.sim.state.seed));
      game.setTime(hour);
    },
    council: {
      issues: () => game.council.issues.map((i) => ({ key: i.key, kind: i.kind, title: i.title, severity: i.severity })),
      convene: (kind) => {
        const issue = game.council.issues.find((i) => i.kind === kind);
        if (!issue) return false;
        return game.convene(issue.key);
      },
      skip: () => game.council.skip(),
      phase: () => game.cinematic.phase,
      cineTime: () => game.cinematic.time,
      inspector: (open) => (ui.inspector.value = open),
      trace: () => ui.trace.value,
    },
    townHall: () => game.ensureTownHall(),
    loadState: (state) => game.loadState(state),
    advance: (n) => {
      for (let i = 0; i < n; i++) game.sim.tick();
    },
    frames: (n) =>
      new Promise<void>((resolve) => {
        const target = game.frameCount + n;
        const check = (): void => {
          if (game.frameCount >= target) resolve();
          else requestAnimationFrame(check);
        };
        check();
      }),
    stats: () => game.stats(),
  };
}
