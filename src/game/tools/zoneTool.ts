import { CELL, MAP } from '../../core/constants';
import { ZONE_RGB } from '../../render/overlays/zoneOverlay';
import { FACILITIES } from '../../sim/facilities';
import { STALL_REASON, stalledByDemand } from '../advice';
import { MAX_DEPTH, frontageOf, reachesRoad } from '../../sim/zoning/lots';
import { DENSITY_NAMES, FACING_DX, FACING_DY, ZONE_NAMES, ZoneType, zoneCode, type Density } from '../../sim/zoning/zones';
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

  /**
   * Why zoned land would not grow right now, or null if it can. Checks the whole city
   * first, then (when given a road-side cell) the street that cell faces.
   */
  private blocker(ctx: ToolContext, cell: Cell | null): string | null {
    const s = ctx.sim.state;
    if (s.sandbox || this.type === ZoneType.None) return null;
    const missing = (what: 'power' | 'water'): string | null => {
      const supply = what === 'power' ? s.stats.powerSupply : s.stats.waterSupply;
      if (supply > 0) return null;
      const building = s.buildings.some((b) => b && b.kind !== 0 && (what === 'power' ? FACILITIES[b.kind]!.power : FACILITIES[b.kind]!.water) > 0);
      if (building) return `Waiting for the ${what === 'power' ? 'power plant' : 'water tower'} to finish building`;
      return what === 'power'
        ? 'Nothing grows without power: place a power plant beside this road (Power button)'
        : 'Nothing grows without water: place a water tower beside this road (Water button)';
    };
    const city = missing('power') ?? missing('water');
    if (city) return city;
    if (stalledByDemand(ctx.sim, this.type)) return STALL_REASON[this.type]!;
    if (!cell) return null;
    if (s.roadCell[cell.j * MAP + cell.i]! < 0 && !reachesRoad(s, cell.i, cell.j)) return `Too far from a road: zone within ${MAX_DEPTH} cells of one`;
    const f: number = frontageOf(s, cell.i, cell.j);
    if (f < 0) return null;
    const net = ctx.sim.net;
    const c = net.comp[(cell.j + FACING_DY[f as 0]!) * MAP + cell.i + FACING_DX[f as 0]!]!;
    if (c < 0) return null;
    if (!(net.powerSupply[c]! > 0)) return 'This road is not connected to a power plant';
    if (!(net.waterSupply[c]! > 0)) return 'This road is not connected to a water tower';
    if (net.powerSupply[c]! <= net.powerDemand[c]!) return 'Power is used up on this road: build another power plant';
    if (net.waterSupply[c]! <= net.waterDemand[c]!) return 'Water is used up on this road: build another water tower';
    return null;
  }

  /** Call after changing type or density. */
  describe(ctx: ToolContext, cell: Cell | null = this.last): void {
    const why = this.blocker(ctx, cell);
    if (why) ctx.hint(why, 'bad');
    else ctx.hint(`${this.label()}: drag along a road (up to ${MAX_DEPTH} cells back)`);
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
    this.describe(ctx, c);
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
