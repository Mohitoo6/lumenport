import type { CameraPose } from '../render/camera/rtsCamera';
import type { Command, CommandResult } from '../sim/commands';
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
  /** Installs a game state (for tests of save and load). */
  loadState(state: import('../sim/state').GameState): void;
  /** Jumps to a time of day (hours) and holds the clock there. */
  time(hour: number): void;
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
