import { CELL, MAP } from '../../core/constants';
import { ZONE_RGB } from '../../render/overlays/zoneOverlay';
import { DENSITY_NAMES, ZONE_NAMES, ZoneType, zoneCode, type Density } from '../../sim/zoning/zones';
import type { GroundPoint, Tool, ToolContext } from './tool';

interface Cell {
  i: number;
  j: number;
}

function cellOf(p: GroundPoint): Cell {
  return { i: Math.max(0, Math.min(MAP - 1, Math.floor(p.x / CELL))), j: Math.max(0, Math.min(MAP - 1, Math.floor(p.z / CELL))) };
}

/** Paints zones by dragging a rectangle. With type None it clears zoning instead. */
export class ZoneTool implements Tool {
  readonly id = 'zone';
  type: ZoneType = ZoneType.Residential;
  density: Density = 1;
  private start: Cell | null = null;
  private last: Cell | null = null;

  activate(ctx: ToolContext): void {
    this.start = null;
    ctx.preview.setZoneView(true);
    ctx.preview.setGrid(true);
    this.describe(ctx);
  }

  deactivate(ctx: ToolContext): void {
    this.start = null;
    ctx.preview.setZoneView(false);
    ctx.preview.setGrid(false);
    ctx.preview.hideRect();
    ctx.preview.hideCursor();
  }

  private label(): string {
    return this.type === ZoneType.None ? 'Clear zoning' : `${ZONE_NAMES[this.type]}, ${DENSITY_NAMES[this.density].toLowerCase()} density`;
  }

  /** Call after changing type or density. */
  describe(ctx: ToolContext): void {
    ctx.hint(`${this.label()}: drag over land beside a road`);
  }

  private show(ctx: ToolContext, a: Cell, b: Cell): void {
    const x0 = Math.min(a.i, b.i) * CELL;
    const z0 = Math.min(a.j, b.j) * CELL;
    const x1 = (Math.max(a.i, b.i) + 1) * CELL;
    const z1 = (Math.max(a.j, b.j) + 1) * CELL;
    if (this.type === ZoneType.None) {
      ctx.preview.showRect(x0, z0, x1, z1, 'remove', 0.45);
    } else {
      const c = ZONE_RGB[this.type]![this.density]!;
      ctx.preview.showRectColor(x0, z0, x1, z1, c[0] / 255, c[1] / 255, c[2] / 255, 0.7);
    }
  }

  move(ctx: ToolContext, p: GroundPoint | null): void {
    if (!p) {
      ctx.preview.hideRect();
      return;
    }
    const c = cellOf(p);
    this.last = c;
    ctx.preview.grid.value.x = p.x;
    ctx.preview.grid.value.y = p.z;
    this.show(ctx, c, c);
  }

  click(): void {
    // Zoning is drag-only; a click is a one-cell drag handled by dragEnd.
  }

  dragStart(ctx: ToolContext, p: GroundPoint): void {
    this.start = cellOf(p);
    this.last = this.start;
    this.show(ctx, this.start, this.start);
  }

  dragMove(ctx: ToolContext, p: GroundPoint | null): void {
    if (!this.start) return;
    if (p) this.last = cellOf(p);
    const b = this.last ?? this.start;
    ctx.preview.grid.value.x = (b.i + 0.5) * CELL;
    ctx.preview.grid.value.y = (b.j + 0.5) * CELL;
    this.show(ctx, this.start, b);
    const w = Math.abs(b.i - this.start.i) + 1;
    const h = Math.abs(b.j - this.start.j) + 1;
    ctx.hint(`${this.label()}  ·  ${w} × ${h} cells`, 'ok');
  }

  dragEnd(ctx: ToolContext, p: GroundPoint | null): void {
    const a = this.start;
    this.start = null;
    if (!a) return;
    const b = p ? cellOf(p) : (this.last ?? a);
    const result = ctx.sim.apply({
      type: 'zoneRect',
      x0: a.i,
      y0: a.j,
      x1: b.i,
      y1: b.j,
      zone: this.type === ZoneType.None ? 0 : zoneCode(this.type, this.density),
    });
    if (!result.ok && result.reason) ctx.toast(result.reason, 'bad');
    this.describe(ctx);
    this.show(ctx, b, b);
  }

  cancel(ctx: ToolContext): boolean {
    if (!this.start) return false;
    this.start = null;
    ctx.preview.hideRect();
    this.describe(ctx);
    return true;
  }
}
