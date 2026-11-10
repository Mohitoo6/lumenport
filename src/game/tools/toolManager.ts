import { Vector3 } from 'three';
import type { RtsCamera } from '../../render/camera/rtsCamera';
import type { ToolPreview } from '../../render/tools/toolPreview';
import { RoadType } from '../../sim/roads/types';
import type { Sim } from '../../sim/sim';
import { ui, type ToolId } from '../../ui/store';
import { pickGround } from '../picking';
import { BulldozeTool } from './bulldozeTool';
import { RoadTool, type RoadMode } from './roadTool';
import type { GroundPoint, Tool, ToolContext } from './tool';

const CLICK_SLOP = 5;

/**
 * Routes mouse input on the 3D view to the active tool. Left click acts, right click (or
 * Escape) steps back and finally puts the tool away. Drags are left to the camera.
 */
export class ToolManager {
  private active: Tool | null = null;
  private readonly road = new RoadTool(RoadType.Street);
  private readonly bulldoze = new BulldozeTool();
  private readonly ctx: ToolContext;
  private readonly hit = new Vector3();
  private downX = 0;
  private downY = 0;
  private downButton = -1;
  private lastX = -1;
  private lastY = -1;
  private toastTimer = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly rig: RtsCamera,
    sim: Sim,
    preview: ToolPreview,
  ) {
    this.ctx = {
      sim,
      preview,
      hint: (text, tone = 'info') => {
        if (this.toastTimer <= 0) ui.hint.value = { text, tone };
        this.pendingHint = { text, tone };
      },
      toast: (text, tone = 'info') => {
        ui.hint.value = { text, tone };
        this.toastTimer = 1.8;
      },
    };
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointerleave', () => {
      this.lastX = -1;
      this.active?.move(this.ctx, null);
    });
    window.addEventListener('keydown', this.onKey);
  }

  private pendingHint: { text: string; tone: 'info' | 'ok' | 'bad' } | null = null;

  select(id: ToolId): void {
    const next: Tool | null = id === 'road' ? this.road : id === 'bulldoze' ? this.bulldoze : null;
    if (next === this.active) return;
    this.active?.deactivate(this.ctx);
    this.active = next;
    ui.tool.value = id;
    this.pendingHint = null;
    this.toastTimer = 0;
    ui.hint.value = null;
    next?.activate(this.ctx);
    this.repick();
  }

  setRoadType(type: RoadType): void {
    this.road.road = type;
    ui.roadType.value = type;
    if (this.active === this.road) this.road.refresh(this.ctx);
    else this.select('road');
  }

  setRoadMode(mode: RoadMode): void {
    this.road.mode = mode;
    ui.roadMode.value = mode;
    if (this.active === this.road) this.road.refresh(this.ctx);
  }

  private ground(clientX: number, clientY: number): GroundPoint | null {
    const r = this.canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    const ny = -(((clientY - r.top) / r.height) * 2 - 1);
    if (!pickGround(this.rig.camera, nx, ny, this.ctx.sim.state.heights, this.hit)) return null;
    return { x: this.hit.x, y: this.hit.y, z: this.hit.z };
  }

  /** Re-evaluates the tool under a stationary cursor (the camera or the world moved). */
  private repick(): void {
    if (!this.active || this.lastX < 0) return;
    this.active.move(this.ctx, this.ground(this.lastX, this.lastY));
  }

  private onDown = (e: PointerEvent): void => {
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.downButton = e.altKey || e.shiftKey ? -1 : e.button;
  };

  private onMove = (e: PointerEvent): void => {
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (!this.active || e.buttons !== 0) return;
    this.active.move(this.ctx, this.ground(e.clientX, e.clientY));
  };

  private onUp = (e: PointerEvent): void => {
    const button = this.downButton;
    this.downButton = -1;
    if (!this.active || button !== e.button) return;
    if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > CLICK_SLOP) return;
    if (button === 0) {
      const g = this.ground(e.clientX, e.clientY);
      if (g) this.active.click(this.ctx, g);
    } else if (button === 2) {
      this.cancel();
    }
  };

  private cancel(): void {
    if (!this.active) return;
    if (!this.active.cancel(this.ctx)) this.select('none');
  }

  private onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.code) {
      case 'Escape':
        this.cancel();
        break;
      case 'KeyX':
        this.select(ui.tool.value === 'bulldoze' ? 'none' : 'bulldoze');
        break;
      case 'KeyC':
        if (this.active === this.road) this.setRoadMode(this.road.mode === 'curve' ? 'straight' : 'curve');
        break;
    }
  };

  /** Keeps the preview under the cursor while the camera moves, and expires toasts. */
  update(dt: number, cameraMoving: boolean): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) ui.hint.value = this.active ? this.pendingHint : null;
    }
    if (cameraMoving) this.repick();
  }
}
