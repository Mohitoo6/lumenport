import { CELL, MAP } from '../../core/constants';
import { edgePolyline } from '../../sim/roads/graph';
import { edgeAt } from '../../sim/roads/plan';
import { ROAD_SPECS } from '../../sim/roads/types';
import { FACILITIES } from '../../sim/facilities';
import { ZONE_NAMES, zoneType } from '../../sim/zoning/zones';
import type { GroundPoint, Tool, ToolContext } from './tool';

/** Removes whatever is under the cursor: a building, or a road segment. */
export class BulldozeTool implements Tool {
  readonly id = 'bulldoze';
  private edge = -1;
  private building = -1;

  activate(ctx: ToolContext): void {
    this.edge = -1;
    this.building = -1;
    ctx.hint('Click a road or building to remove it');
  }

  deactivate(ctx: ToolContext): void {
    ctx.preview.hideRoad();
    ctx.preview.hideCursor();
    ctx.preview.hideRect();
  }

  move(ctx: ToolContext, p: GroundPoint | null): void {
    const s = ctx.sim.state;
    const net = s.roads;
    this.edge = -1;
    this.building = -1;
    ctx.preview.hideRoad();
    ctx.preview.hideRect();
    ctx.preview.hideCursor();
    if (!p) return;

    const i = Math.floor(p.x / CELL);
    const j = Math.floor(p.z / CELL);
    const id = p.building ?? (i >= 0 && j >= 0 && i < MAP && j < MAP ? s.buildingCell[j * MAP + i]! : -1);
    const b = id >= 0 ? s.buildings[id] : null;
    if (b) {
      this.building = b.id;
      ctx.preview.showRect(b.x * CELL, b.y * CELL, (b.x + b.w) * CELL, (b.y + b.h) * CELL, 'remove', 0.55);
      ctx.hint(b.kind !== 0 ? `Demolish ${FACILITIES[b.kind]!.name.toLowerCase()}` : `Demolish ${ZONE_NAMES[zoneType(b.zone)].toLowerCase()} building`, 'bad');
      return;
    }
    this.edge = edgeAt(net, p.x, p.z, 2);
    const e = this.edge >= 0 ? net.edges[this.edge] : null;
    if (!e) {
      ctx.preview.showCursor(p.x, p.z, 4, 'remove');
      ctx.hint('Click a road or building to remove it');
      return;
    }
    const a = net.nodes[e.a]!;
    const bn = net.nodes[e.b]!;
    const spec = ROAD_SPECS[e.type];
    ctx.preview.showRoad(a.x, a.z, e.cx, e.cz, bn.x, bn.z, spec.width, spec.width - spec.sidewalk * 2, 'remove');
    ctx.hint(`Remove ${Math.round(edgePolyline(net, e).length)} m of ${spec.name.toLowerCase()}`, 'bad');
  }

  click(ctx: ToolContext, p: GroundPoint): void {
    if (this.building >= 0) ctx.sim.apply({ type: 'bulldozeBuilding', id: this.building });
    else if (this.edge >= 0) ctx.sim.apply({ type: 'bulldozeRoad', edge: this.edge });
    else return;
    this.move(ctx, p);
  }

  cancel(): boolean {
    return false;
  }
}
