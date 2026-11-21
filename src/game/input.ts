import { Vector3 } from 'three';
import type { RtsCamera } from '../render/camera/rtsCamera';
import { pickGround, pickPlane } from './picking';

/** What a two-finger scroll (or a mouse wheel) does: guess per device, always zoom, or always move. */
export type ScrollMode = 'auto' | 'zoom' | 'pan';

export interface InputOptions {
  edgeScroll: boolean;
  /** Whether a plain left-drag on the map may move it (false while a tool needs the drag, e.g. zoning). */
  leftDragPans?: () => boolean;
  scrollMode?: () => ScrollMode;
}

const EDGE_PX = 14;
/** Movement before a press becomes a drag; below it, it stays a click (inspect, place). */
const DRAG_SLOP = 5;
/** How long a detected trackpad gesture keeps its events treated as a trackpad. */
const TRACKPAD_HOLD_MS = 350;

/**
 * Camera input: keyboard, mouse, trackpad and touch.
 *
 *   pan      left-drag on the map (not while zoning), two-finger swipe on a trackpad,
 *            one-finger drag on a touch screen, middle-drag or Shift+left-drag,
 *            WASD / arrows, screen edges
 *   rotate   right-drag or Alt+left-drag (vertical drag tilts), two-finger twist on a
 *            touch screen, Q / E
 *   tilt     R / F
 *   zoom     mouse wheel or pinch (trackpad or touch), toward the cursor
 */
export class CameraInput {
  private readonly keys = new Set<string>();
  private drag: 'none' | 'rotate' | 'pan' | 'maybe-pan' = 'none';
  private lastX = 0;
  private lastY = 0;
  private downX = 0;
  private downY = 0;
  private mouseX = -1;
  private mouseY = -1;
  private mouseInside = false;
  private trackpadUntil = 0;
  /** Touch points on the screen, by pointer id. */
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; angle: number; mx: number; my: number } | null = null;
  private readonly a = new Vector3();
  private readonly b = new Vector3();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly rig: RtsCamera,
    private readonly getHeights: () => Float32Array,
    readonly options: InputOptions,
  ) {
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseInside = false;
    });
    document.addEventListener('mouseleave', () => (this.mouseInside = false));
    document.addEventListener('mouseenter', () => (this.mouseInside = true));
  }

  private ndc(clientX: number, clientY: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1)];
  }

  /** Moves the camera so the ground under screen point (x0, y0) ends up under (x1, y1). */
  private grab(x0: number, y0: number, x1: number, y1: number): void {
    const [ax, ay] = this.ndc(x0, y0);
    const [bx, by] = this.ndc(x1, y1);
    const cam = this.rig.camera;
    if (pickPlane(cam, ax, ay, this.rig.focusY, this.a) && pickPlane(cam, bx, by, this.rig.focusY, this.b)) {
      this.rig.panWorld(this.a.x - this.b.x, this.a.z - this.b.z);
    }
  }

  private zoomAt(factor: number, clientX: number, clientY: number): void {
    const [nx, ny] = this.ndc(clientX, clientY);
    if (pickGround(this.rig.camera, nx, ny, this.getHeights(), this.a)) this.rig.zoom(factor, this.a.x, this.a.z);
    else this.rig.zoom(factor);
  }

  /**
   * A wheel event is either a mouse wheel or a two-finger trackpad swipe; the browser does
   * not say which. Trackpads send sideways movement, fractional or small steps, and long
   * runs of events; mouse wheels send line steps or whole notches. A detected trackpad
   * gesture is remembered briefly so one swipe is not split between the two meanings.
   */
  private isTrackpad(e: WheelEvent): boolean {
    const mode = this.options.scrollMode?.() ?? 'auto';
    if (mode !== 'auto') return mode === 'pan';
    const now = performance.now();
    if (e.deltaMode !== 0) return false;
    const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
    const notch = e.deltaX === 0 && legacy !== undefined && legacy !== 0 && legacy % 120 === 0 && Math.abs(e.deltaY) >= 50;
    const looksPad = e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 50;
    if (now < this.trackpadUntil || (looksPad && !notch)) {
      this.trackpadUntil = now + TRACKPAD_HOLD_MS;
      return true;
    }
    return false;
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // Pinch gestures arrive as ctrl+wheel with small deltas.
    if (e.ctrlKey) {
      this.zoomAt(Math.exp(Math.max(-240, Math.min(240, e.deltaY)) * 0.012), e.clientX, e.clientY);
      return;
    }
    if (this.isTrackpad(e)) {
      // Two-finger swipe: the map follows the fingers, like scrolling a page.
      const unit = e.deltaMode === 1 ? 33 : 1;
      const cx = this.canvas.clientWidth / 2;
      const cy = this.canvas.clientHeight / 2;
      this.grab(cx + e.deltaX * unit, cy + e.deltaY * unit, cx, cy);
      return;
    }
    // Line-mode wheels need scaling.
    const unit = e.deltaMode === 1 ? 33 : 1;
    this.zoomAt(Math.exp(Math.max(-240, Math.min(240, e.deltaY * unit)) * 0.0016), e.clientX, e.clientY);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.canvas.setPointerCapture(e.pointerId);
      if (this.touches.size === 2) {
        this.pinch = this.pinchState();
        this.drag = 'none';
        return;
      }
    }
    if (e.button === 2 || (e.button === 0 && e.altKey)) this.drag = 'rotate';
    else if (e.button === 1 || (e.button === 0 && e.shiftKey)) this.drag = 'pan';
    // A plain left press may become a pan once it moves; until then it is still a click.
    else if (e.button === 0 && (this.options.leftDragPans?.() ?? false)) this.drag = 'maybe-pan';
    else return;
    if (this.drag !== 'maybe-pan') e.preventDefault();
    this.lastX = this.downX = e.clientX;
    this.lastY = this.downY = e.clientY;
    if (!this.canvas.hasPointerCapture(e.pointerId)) this.canvas.setPointerCapture(e.pointerId);
  };

  private pinchState(): { dist: number; angle: number; mx: number; my: number } {
    const [p, q] = [...this.touches.values()] as [{ x: number; y: number }, { x: number; y: number }];
    return { dist: Math.hypot(q.x - p.x, q.y - p.y), angle: Math.atan2(q.y - p.y, q.x - p.x), mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2 };
  }

  private onPointerMove = (e: PointerEvent): void => {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    this.mouseInside = true;
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.get(e.pointerId)!.x = e.clientX;
      this.touches.get(e.pointerId)!.y = e.clientY;
      if (this.touches.size >= 2 && this.pinch) {
        // Two fingers: spread to zoom, twist to rotate, move together to pan.
        const now = this.pinchState();
        if (now.dist > 10 && this.pinch.dist > 10) this.zoomAt(this.pinch.dist / now.dist, now.mx, now.my);
        let turn = now.angle - this.pinch.angle;
        if (turn > Math.PI) turn -= Math.PI * 2;
        if (turn < -Math.PI) turn += Math.PI * 2;
        this.rig.rotate(-turn, 0);
        this.grab(this.pinch.mx, this.pinch.my, now.mx, now.my);
        this.pinch = now;
        return;
      }
    }
    if (this.drag === 'none') return;
    if (this.drag === 'maybe-pan') {
      if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) < DRAG_SLOP) return;
      this.drag = 'pan';
    }
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    if (this.drag === 'rotate') this.rig.rotate(dx * 0.0052, dy * 0.0042);
    // Grab the ground: keep the point under the cursor attached to it.
    else this.grab(this.lastX, this.lastY, e.clientX, e.clientY);
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      // A finger leaving the screen is not a cursor resting at its edge.
      this.mouseInside = false;
      this.touches.delete(e.pointerId);
      if (this.touches.size < 2) this.pinch = null;
      // The finger left on the screen carries on panning from where it is.
      const rest = [...this.touches.values()][0];
      if (rest) {
        this.lastX = rest.x;
        this.lastY = rest.y;
      }
    }
    if (this.drag === 'none') return;
    if (e.pointerType !== 'touch' || this.touches.size === 0) this.drag = 'none';
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
  };

  /** True while the camera is being dragged, so tools can ignore the movement. */
  get dragging(): boolean {
    return this.drag === 'pan' || this.drag === 'rotate' || this.pinch !== null;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey) return;
    this.keys.add(e.code);
  };

  private down(...codes: string[]): boolean {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  /** Applies held keys and edge scrolling. Call once per frame. */
  update(dt: number): void {
    let right = 0;
    let fwd = 0;
    if (this.down('KeyA', 'ArrowLeft')) right -= 1;
    if (this.down('KeyD', 'ArrowRight')) right += 1;
    if (this.down('KeyW', 'ArrowUp')) fwd += 1;
    if (this.down('KeyS', 'ArrowDown')) fwd -= 1;

    if (this.options.edgeScroll && this.mouseInside && this.drag === 'none' && this.touches.size === 0 && document.hasFocus()) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (this.mouseX >= 0 && this.mouseX < EDGE_PX) right -= 1;
      else if (this.mouseX > w - EDGE_PX) right += 1;
      if (this.mouseY >= 0 && this.mouseY < EDGE_PX) fwd += 1;
      else if (this.mouseY > h - EDGE_PX) fwd -= 1;
    }

    if (right !== 0 || fwd !== 0) {
      const len = Math.hypot(right, fwd);
      const speed = 0.95 * dt;
      this.rig.pan((right / len) * speed, (fwd / len) * speed);
    }
    let yaw = 0;
    if (this.down('KeyQ')) yaw -= 1;
    if (this.down('KeyE')) yaw += 1;
    let tilt = 0;
    if (this.down('KeyR')) tilt += 1;
    if (this.down('KeyF')) tilt -= 1;
    if (yaw !== 0 || tilt !== 0) this.rig.rotate(yaw * 1.5 * dt, tilt * 0.9 * dt);
  }
}
