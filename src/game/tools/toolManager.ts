import { Vector3 } from 'three';
import type { RtsCamera } from '../../render/camera/rtsCamera';
import type { ToolPreview } from '../../render/tools/toolPreview';
import { RoadType } from '../../sim/roads/types';
import type { Sim } from '../../sim/sim';
import { ui, type ToolId } from '../../ui/store';
import { pickBuilding, pickGround } from '../picking';
import { BulldozeTool } from './bulldozeTool';
import { PlaceTool } from './placeTool';
import { RoadTool, type RoadMode } from './roadTool';
import { ZoneTool } from './zoneTool';
import { MetroTool } from './metroTool';
import { SculptTool } from './sculptTool';
import type { SculptMode } from '../../sim/map/sculpt';
import type { Density, ZoneType } from '../../sim/zoning/zones';
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
  private readonly zone = new ZoneTool();
  private readonly place = new PlaceTool();
  private readonly metro = new MetroTool();
  private readonly sculpt = new SculptTool();
  private dragging = false;
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
    private readonly buildingHeight: (id: number) => number,
    /** Called when the player clicks with no tool active: a building id, or -1. */
    private readonly onInspect: (building: number) => void,
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
    const next: Tool | null = id === 'road' ? this.road : id === 'bulldoze' ? this.bulldoze : id === 'zone' ? this.zone : id === 'place' ? this.place : id === 'metro' ? this.metro : id === 'terrain' ? this.sculpt : null;
    if (next === this.active) return;
    this.active?.deactivate(this.ctx);
    this.dragging = false;
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

  /** Picks a zone to paint. Type 0 selects the de-zone brush. */
  setZone(type: ZoneType, density: Density): void {
    this.zone.type = type;
    this.zone.density = density;
    ui.zoneType.value = type;
    ui.zoneDensity.value = density;
    if (this.active === this.zone) this.zone.describe(this.ctx);
    else this.select('zone');
  }

  /** Picks a facility to place. */
  setZoneMode(mode: import('./zoneTool').ZoneMode): void {
    this.zone.mode = mode;
    ui.zoneMode.value = mode;
    this.ctx.preview.zoneOverlay?.clearPreview();
    if (this.active === this.zone) this.zone.describe(this.ctx);
  }

  /** Picks the terrain brush's action and size. */
  setSculpt(mode: SculptMode, size: number): void {
    this.sculpt.mode = mode;
    this.sculpt.size = size;
    ui.sculptMode.value = mode;
    ui.sculptSize.value = size;
    if (this.active === this.sculpt) this.sculpt.describe(this.ctx);
    else this.select('terrain');
  }

  setFacility(kind: number): void {
    this.place.kind = kind;
    ui.facility.value = kind;
    if (this.active === this.place) this.place.describe(this.ctx);
    else this.select('place');
  }

  private ground(clientX: number, clientY: number): GroundPoint | null {
    const r = this.canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    const ny = -(((clientY - r.top) / r.height) * 2 - 1);
    const cam = this.rig.camera;
    const onGround = pickGround(cam, nx, ny, this.ctx.sim.state.heights, this.hit);
    const reach = onGround ? this.hit.distanceTo(cam.position) : 9000;
    const b = pickBuilding(cam, nx, ny, this.ctx.sim.state.buildings, this.buildingHeight, reach);
    if (b) return { x: b.x, y: this.ctx.sim.state.buildings[b.id]!.baseY, z: b.z, building: b.id };
    if (!onGround) return null;
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
    if (this.downButton === 0 && this.active?.dragStart) {
      const g = this.ground(e.clientX, e.clientY);
      if (g) {
        this.dragging = true;
        this.active.dragStart(this.ctx, g);
      }
    }
  };

  private onMove = (e: PointerEvent): void => {
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (!this.active) return;
    if (this.dragging) {
      this.active.dragMove?.(this.ctx, this.ground(e.clientX, e.clientY));
      return;
    }
    if (e.buttons !== 0) return;
    this.active.move(this.ctx, this.ground(e.clientX, e.clientY));
  };

  private onUp = (e: PointerEvent): void => {
    const button = this.downButton;
    this.downButton = -1;
    if (this.dragging) {
      this.dragging = false;
      if (e.button === 0) this.active?.dragEnd?.(this.ctx, this.ground(e.clientX, e.clientY));
      return;
    }
    if (button !== e.button) return;
    if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > CLICK_SLOP) return;
    if (!this.active) {
      if (button === 0) this.onInspect(this.ground(e.clientX, e.clientY)?.building ?? -1);
      return;
    }
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
    if (ui.council.value) return;
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
    if (this.dragging) this.active?.hold?.(this.ctx, dt);
    if (cameraMoving && !this.dragging) this.repick();
  }
}
