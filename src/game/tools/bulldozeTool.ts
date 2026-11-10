import { edgePolyline } from '../../sim/roads/graph';
import { edgeAt } from '../../sim/roads/plan';
import { ROAD_SPECS } from '../../sim/roads/types';
import type { GroundPoint, Tool, ToolContext } from './tool';

/** Removes whatever is under the cursor. For now that means road segments. */
export class BulldozeTool implements Tool {
  readonly id = 'bulldoze';
  private target = -1;

  activate(ctx: ToolContext): void {
    this.target = -1;
    ctx.hint('Click a road to remove it');
  }

  deactivate(ctx: ToolContext): void {
    ctx.preview.hideRoad();
    ctx.preview.hideCursor();
  }

  move(ctx: ToolContext, p: GroundPoint | null): void {
    const net = ctx.sim.state.roads;
    this.target = p ? edgeAt(net, p.x, p.z, 2) : -1;
    const e = this.target >= 0 ? net.edges[this.target] : null;
    if (!e || !p) {
      ctx.preview.hideRoad();
      if (p) ctx.preview.showCursor(p.x, p.z, 4, 'remove');
      else ctx.preview.hideCursor();
      ctx.hint('Click a road to remove it');
      return;
    }
    const a = net.nodes[e.a]!;
    const b = net.nodes[e.b]!;
    const spec = ROAD_SPECS[e.type];
    ctx.preview.hideCursor();
    ctx.preview.showRoad(a.x, a.z, e.cx, e.cz, b.x, b.z, spec.width, spec.width - spec.sidewalk * 2, 'remove');
    ctx.hint(`Remove ${Math.round(edgePolyline(net, e).length)} m of ${spec.name.toLowerCase()}`, 'bad');
  }

  click(ctx: ToolContext, p: GroundPoint): void {
    if (this.target < 0) return;
    ctx.sim.apply({ type: 'bulldozeRoad', edge: this.target });
    this.target = -1;
    this.move(ctx, p);
  }

  cancel(): boolean {
    return false;
  }
}
