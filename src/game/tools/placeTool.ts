import { CELL, MAP } from '../../core/constants';
import { FACILITIES, type FacilityKind } from '../../sim/facilities';
import { money, type GroundPoint, type Tool, type ToolContext } from './tool';

/** Places a facility: the footprint follows the cursor, green where it can go. */
export class PlaceTool implements Tool {
  readonly id = 'place';
  kind: FacilityKind = 1 as FacilityKind;
  private last: GroundPoint | null = null;

  activate(ctx: ToolContext): void {
    ctx.preview.setGrid(true);
    this.describe(ctx);
  }

  deactivate(ctx: ToolContext): void {
    ctx.preview.setGrid(false);
    ctx.preview.hideRect();
  }

  /** Call after changing `kind`. */
  describe(ctx: ToolContext): void {
    const spec = FACILITIES[this.kind]!;
    ctx.hint(`${spec.name}  ·  ${money(spec.cost)}  ·  place beside a road`);
    if (this.last) this.move(ctx, this.last);
  }

  move(ctx: ToolContext, p: GroundPoint | null): void {
    this.last = p;
    if (!p) {
      ctx.preview.hideRect();
      return;
    }
    const spec = FACILITIES[this.kind]!;
    const s = ctx.sim.state;
    const i = Math.max(0, Math.min(MAP - 1, Math.floor(p.x / CELL)));
    const j = Math.max(0, Math.min(MAP - 1, Math.floor(p.z / CELL)));
    const plan = ctx.sim.planFacility(this.kind, i, j);
    const broke = plan.ok && !s.sandbox && s.funds < plan.cost;
    const ok = plan.ok && !broke;
    ctx.preview.grid.value.x = p.x;
    ctx.preview.grid.value.y = p.z;
    ctx.preview.showRect(plan.x * CELL, plan.y * CELL, (plan.x + plan.size) * CELL, (plan.y + plan.size) * CELL, ok ? 'ok' : 'bad', 0.6);
    if (ok) {
      const out = spec.power > 0 ? `${spec.power} MW` : `${spec.water.toLocaleString('en-US')} water`;
      ctx.hint(`${spec.name}  ·  ${money(spec.cost)}  ·  ${out}  ·  ${money(spec.upkeep)}/month`, 'ok');
    } else {
      ctx.hint(broke ? 'Not enough money' : plan.reason, 'bad');
    }
  }

  click(ctx: ToolContext, p: GroundPoint): void {
    const i = Math.floor(p.x / CELL);
    const j = Math.floor(p.z / CELL);
    const result = ctx.sim.apply({ type: 'placeFacility', kind: this.kind, x: i, y: j });
    if (!result.ok && result.reason) ctx.toast(result.reason, 'bad');
    this.move(ctx, p);
  }

  cancel(): boolean {
    return false;
  }
}
