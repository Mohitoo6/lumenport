import type { Speed } from './state';

/** Every mutation of the game goes through a command. Commands are plain serialisable data. */
export type Command =
  | { type: 'setSpeed'; speed: Speed }
  | { type: 'renameCity'; name: string };

export interface CommandResult {
  ok: boolean;
  /** Human-readable reason when ok is false. */
  reason?: string;
}

export const OK: CommandResult = { ok: true };

export function fail(reason: string): CommandResult {
  return { ok: false, reason };
}
