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
