import { CELL, MAP } from '../../core/constants';
import { isStation, smoothPath, stationCentre } from '../../sim/transit/metro';
import { money, type GroundPoint, type Tool, type ToolContext } from './tool';

/**
 * Draws a metro line: click a station to start, click the ground to bend the line through
 * that point (as many times as you like), and click another station to build it. Right
 * click or Escape removes the last bend, then the start.
 */
export class MetroTool implements Tool {
  readonly id = 'metro';
  private start = -1;
  private via: Array<[number, number]> = [];

  private stationAt(ctx: ToolContext, p: GroundPoint): number {
    const s = ctx.sim.state;
    const i = Math.floor(p.x / CELL);
    const j = Math.floor(p.z / CELL);
    const id = p.building ?? (i >= 0 && j >= 0 && i < MAP && j < MAP ? s.buildingCell[j * MAP + i]! : -1);
    return isStation(s.buildings[id]) ? id : -1;
  }

  activate(ctx: ToolContext): void {
    this.start = -1;
    this.via = [];
    this.describe(ctx);
  }

  deactivate(ctx: ToolContext): void {
    this.start = -1;
    this.via = [];
    ctx.preview.metroPreview?.(null, true);
    ctx.preview.hideRect();
  }

  private describe(ctx: ToolContext): void {
    const stations = ctx.sim.state.buildings.filter((b) => isStation(b)).length;
    if (stations < 2) ctx.hint(`A line joins two metro stations: place ${stations === 0 ? 'two stations' : 'one more station'} first (Metro › Station)`, 'bad');
    else if (this.start < 0) ctx.hint('Click a metro station to start the line');
    else ctx.hint(`Click the ground to bend the line, or another station to finish  ·  ${this.via.length} bend${this.via.length === 1 ? '' : 's'}`);
  }

  private highlight(ctx: ToolContext, id: number): void {
    const b = ctx.sim.state.buildings[id];
    if (!b) {
      ctx.preview.hideRect();
      return;
    }
    ctx.preview.showRect(b.x * CELL, b.y * CELL, (b.x + b.w) * CELL, (b.y + b.h) * CELL, 'ok', 0.5);
  }

  move(ctx: ToolContext, p: GroundPoint | null): void {
    if (!p) return;
    const s = ctx.sim.state;
    const st = this.stationAt(ctx, p);
    if (st >= 0) this.highlight(ctx, st);
    else ctx.preview.hideRect();
    if (this.start < 0) {
      ctx.preview.metroPreview?.(null, true);
      this.describe(ctx);
      return;
    }
    const a = s.buildings[this.start];
    if (!isStation(a)) {
      this.start = -1;
      return;
    }
    if (st >= 0 && st !== this.start) {
      const plan = ctx.sim.planMetro(this.start, st, this.via);
      ctx.preview.metroPreview?.(plan.pts, plan.ok);
      if (plan.ok) ctx.hint(`Build ${(plan.length / 1000).toFixed(2)} km of metro  ·  ${money(plan.cost)}${!s.sandbox && s.funds < plan.cost ? '  ·  not enough money' : ''}`, !s.sandbox && s.funds < plan.cost ? 'bad' : 'ok');
      else ctx.hint(plan.reason, 'bad');
      return;
    }
    // Following the cursor: the line so far, ending where the pointer is.
    const pts = smoothPath([stationCentre(a), ...this.via, [p.x, p.z]]);
    ctx.preview.metroPreview?.(pts, true);
    this.describe(ctx);
  }

  click(ctx: ToolContext, p: GroundPoint): void {
    const st = this.stationAt(ctx, p);
    if (this.start < 0) {
      if (st >= 0) this.start = st;
      else ctx.toast('Start on a metro station', 'bad');
      this.move(ctx, p);
      return;
    }
    if (st === this.start) return;
    if (st >= 0) {
      const r = ctx.sim.apply({ type: 'buildMetro', a: this.start, b: st, via: this.via });
      if (!r.ok) {
        ctx.toast(r.reason ?? 'Could not build the line', 'bad');
        return;
      }
      ctx.toast(`Metro line built  ·  ${money(r.cost ?? 0)}`, 'ok');
      // Carry on from the station just reached, ready to extend the network.
      this.start = st;
      this.via = [];
      ctx.preview.metroPreview?.(null, true);
      this.describe(ctx);
      return;
    }
    if (this.via.length < 24) this.via.push([p.x, p.z]);
    this.move(ctx, p);
  }

  cancel(ctx: ToolContext): boolean {
    if (this.via.length > 0) this.via.pop();
    else if (this.start >= 0) this.start = -1;
    else return false;
    ctx.preview.metroPreview?.(null, true);
    this.describe(ctx);
    return true;
  }
}
