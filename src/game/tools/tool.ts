import type { ToolPreview } from '../../render/tools/toolPreview';
import type { Sim } from '../../sim/sim';

export type HintTone = 'info' | 'ok' | 'bad';

export interface ToolContext {
  sim: Sim;
  preview: ToolPreview;
  /** Text shown above the toolbar. */
  hint(text: string, tone?: HintTone): void;
  /** A brief message for the result of an action (for example, a refused build). */
  toast(text: string, tone?: HintTone): void;
}

/** A ground point under the cursor, or null when the cursor is over sky or the HUD. */
export interface GroundPoint {
  x: number;
  y: number;
  z: number;
}

export interface Tool {
  readonly id: string;
  activate(ctx: ToolContext): void;
  deactivate(ctx: ToolContext): void;
  move(ctx: ToolContext, p: GroundPoint | null): void;
  click(ctx: ToolContext, p: GroundPoint): void;
  /** Steps back (for example, drops the start point). Returns false if there was nothing to undo. */
  cancel(ctx: ToolContext): boolean;
}

export function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}
