import { SCULPT, type SculptMode } from '../../sim/map/sculpt';
import { money, type GroundPoint, type Tool, type ToolContext } from './tool';

/** Strokes per second while the button is held. */
const RATE = 12;
const STRENGTH = 0.5;

const VERB: Record<SculptMode, string> = {
  raise: 'Raise the ground',
  lower: 'Lower the ground',
  flatten: 'Level the ground to where you started',
  smooth: 'Smooth the ground',
};

/**
 * The terrain brush: hold the left button to raise, lower, level or smooth the ground
 * under the cursor, and drag to paint. Roads, buildings and water are left as they are.
 */
export class SculptTool implements Tool {
  readonly id = 'terrain';
  mode: SculptMode = 'raise';
  size = 1;
  private at: GroundPoint | null = null;
  private holding = false;
  private target = 0;
  private clock = 0;
  private spent = 0;
  private refused = false;

  get radius(): number {
    return SCULPT.radii[this.size] ?? SCULPT.radii[1];
  }

  activate(ctx: ToolContext): void {
    this.describe(ctx);
  }

  deactivate(ctx: ToolContext): void {
    this.holding = false;
    ctx.preview.hideBrush();
  }

  describe(ctx: ToolContext): void {
    ctx.hint(`${VERB[this.mode]}: hold the left button and drag. Roads, buildings and water stay put`);
    if (this.at) this.cursor(ctx, this.at);
  }

  private cursor(ctx: ToolContext, p: GroundPoint): void {
    ctx.preview.showBrush(p.x, p.z, this.radius, this.mode === 'lower' ? 'remove' : this.mode === 'raise' ? 'ok' : 'neutral');
  }

  move(ctx: ToolContext, p: GroundPoint | null): void {
    this.at = p;
    if (!p) {
      ctx.preview.hideBrush();
      return;
    }
    this.cursor(ctx, p);
  }

  click(ctx: ToolContext, p: GroundPoint): void {
    this.target = p.y;
    this.stroke(ctx, p);
  }

  dragStart(ctx: ToolContext, p: GroundPoint): void {
    this.at = p;
    this.holding = true;
    this.target = p.y;
    this.clock = 0;
    this.spent = 0;
    this.refused = false;
    this.stroke(ctx, p);
  }

  dragMove(ctx: ToolContext, p: GroundPoint | null): void {
    if (p) {
      this.at = p;
      this.cursor(ctx, p);
    }
  }

  dragEnd(ctx: ToolContext): void {
    this.holding = false;
    if (this.spent > 0) ctx.toast(`Earthworks: ${money(this.spent)}`, 'ok');
  }

  /** Called every frame while the button is down. */
  hold(ctx: ToolContext, dt: number): void {
    if (!this.holding || !this.at) return;
    this.clock += dt;
    while (this.clock >= 1 / RATE) {
      this.clock -= 1 / RATE;
      this.stroke(ctx, this.at);
    }
    this.cursor(ctx, this.at);
  }

  private stroke(ctx: ToolContext, p: GroundPoint): void {
    if (p.building !== undefined) return;
    const r = ctx.sim.apply({ type: 'sculpt', x: p.x, z: p.z, radius: this.radius, mode: this.mode, strength: STRENGTH, target: this.target });
    if (r.ok) {
      this.spent += r.cost ?? 0;
      return;
    }
    // Say why once per drag, not twelve times a second.
    if (!this.refused) ctx.toast(r.reason ?? 'Cannot change the ground here', 'bad');
    this.refused = true;
  }

  cancel(): boolean {
    return false;
  }
}
