import { CELL } from '../../core/constants';
import { snapToNetwork, type RoadPlan } from '../../sim/roads/plan';
import { ROAD_SPECS, type RoadType } from '../../sim/roads/types';
import { money, type GroundPoint, type Tool, type ToolContext } from './tool';

export type RoadMode = 'straight' | 'curve';

interface P2 {
  x: number;
  z: number;
}

/**
 * Lays roads. Straight mode: click the start, click the end. Curve mode: click the start,
 * click where the road should bend toward, click the end. After each road the tool keeps
 * going from the end point, so a whole street can be drawn in one run.
 */
export class RoadTool implements Tool {
  readonly id = 'road';
  road: RoadType;
  mode: RoadMode = 'straight';
  private start: P2 | null = null;
  private control: P2 | null = null;
  private cursor: P2 | null = null;
  private plan: RoadPlan | null = null;

  constructor(road: RoadType) {
    this.road = road;
  }

  activate(ctx: ToolContext): void {
    this.reset();
    ctx.preview.setGrid(true);
    this.refresh(ctx);
  }

  deactivate(ctx: ToolContext): void {
    this.reset();
    ctx.preview.setGrid(false);
    ctx.preview.hideRoad();
    ctx.preview.hideCursor();
  }

  private reset(): void {
    this.start = null;
    this.control = null;
    this.plan = null;
  }

  /** Call after changing `road` or `mode` so the preview and hint follow. */
  refresh(ctx: ToolContext): void {
    if (this.mode === 'straight') this.control = null;
    this.update(ctx);
  }

  /** Snaps to the road network first, then to the build grid. */
  private snap(ctx: ToolContext, p: GroundPoint): P2 {
    const s = snapToNetwork(ctx.sim.state.roads, p.x, p.z);
    if (s.node >= 0 || s.edge >= 0) return { x: s.x, z: s.z };
    return { x: Math.round(p.x / CELL) * CELL, z: Math.round(p.z / CELL) * CELL };
  }

  move(ctx: ToolContext, p: GroundPoint | null): void {
    this.cursor = p ? this.snap(ctx, p) : null;
    this.update(ctx);
  }

  private update(ctx: ToolContext): void {
    const spec = ROAD_SPECS[this.road];
    const roadway = spec.width - spec.sidewalk * 2;
    const c = this.cursor;
    this.plan = null;
    if (!c) {
      ctx.preview.hideCursor();
      ctx.preview.hideRoad();
      return;
    }
    if (!this.start) {
      ctx.preview.hideRoad();
      ctx.preview.showCursor(c.x, c.z, spec.width / 2, 'neutral');
      ctx.hint(`${spec.name}: click to start`);
      return;
    }
    if (this.mode === 'curve' && !this.control) {
      // Show the first leg as a guide while the bend point is being chosen.
      ctx.preview.showRoad(this.start.x, this.start.z, (this.start.x + c.x) / 2, (this.start.z + c.z) / 2, c.x, c.z, 2.5, 0, 'neutral');
      ctx.preview.showCursor(c.x, c.z, 3, 'neutral');
      ctx.hint('Click where the road should bend');
      return;
    }
    const plan = ctx.sim.planRoad({
      road: this.road,
      ax: this.start.x,
      az: this.start.z,
      bx: c.x,
      bz: c.z,
      cx: this.control?.x,
      cz: this.control?.z,
    });
    this.plan = plan;
    const tone = plan.ok ? 'ok' : 'bad';
    ctx.preview.showRoad(plan.ax, plan.az, plan.cx, plan.cz, plan.bx, plan.bz, spec.width, roadway, tone);
    ctx.preview.showCursor(plan.bx, plan.bz, spec.width / 2, tone);
    if (plan.ok) {
      const bridge = plan.bridgeLength > 1 ? `  ·  ${Math.round(plan.bridgeLength)} m of bridge` : '';
      ctx.hint(`${Math.round(plan.length)} m  ·  ${money(plan.cost)}${bridge}`, 'ok');
    } else if (plan.reason === 'Too short') {
      ctx.hint('Click to place the end');
    } else {
      ctx.hint(plan.reason, 'bad');
    }
  }

  click(ctx: ToolContext, p: GroundPoint): void {
    const c = this.snap(ctx, p);
    this.cursor = c;
    if (!this.start) {
      this.start = c;
      this.update(ctx);
      return;
    }
    if (this.mode === 'curve' && !this.control) {
      if (Math.hypot(c.x - this.start.x, c.z - this.start.z) >= CELL) this.control = c;
      this.update(ctx);
      return;
    }
    const result = ctx.sim.apply({
      type: 'buildRoad',
      road: this.road,
      ax: this.start.x,
      az: this.start.z,
      bx: c.x,
      bz: c.z,
      cx: this.control?.x,
      cz: this.control?.z,
    });
    if (result.ok) {
      // Carry on from where this road ended.
      const end = this.plan ? { x: this.plan.bx, z: this.plan.bz } : c;
      this.start = end;
      this.control = null;
    } else if (result.reason && result.reason !== 'Too short') {
      ctx.toast(result.reason, 'bad');
    }
    this.update(ctx);
  }

  cancel(ctx: ToolContext): boolean {
    if (this.control) {
      this.control = null;
    } else if (this.start) {
      this.start = null;
    } else {
      return false;
    }
    this.update(ctx);
    return true;
  }
}
