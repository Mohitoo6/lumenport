import { Vector3 } from 'three';
import type { RtsCamera } from '../render/camera/rtsCamera';
import { pickGround, pickPlane } from './picking';

export interface InputOptions {
  edgeScroll: boolean;
}

const EDGE_PX = 14;

/**
 * Camera input: keyboard, mouse and trackpad.
 *
 *   pan      WASD / arrows, middle-drag or Shift+left-drag, screen edges
 *   rotate   Q / E, right-drag or Alt+left-drag (vertical drag tilts)
 *   tilt     R / F
 *   zoom     wheel or pinch, toward the cursor
 */
export class CameraInput {
  private readonly keys = new Set<string>();
  private drag: 'none' | 'rotate' | 'pan' = 'none';
  private lastX = 0;
  private lastY = 0;
  private mouseX = -1;
  private mouseY = -1;
  private mouseInside = false;
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

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // Pinch gestures arrive as ctrl+wheel with small deltas; line-mode wheels need scaling.
    const unit = e.deltaMode === 1 ? 33 : 1;
    const k = e.ctrlKey ? 0.012 : 0.0016;
    const factor = Math.exp(Math.max(-240, Math.min(240, e.deltaY * unit)) * k);
    const [nx, ny] = this.ndc(e.clientX, e.clientY);
    if (pickGround(this.rig.camera, nx, ny, this.getHeights(), this.a)) this.rig.zoom(factor, this.a.x, this.a.z);
    else this.rig.zoom(factor);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button === 2 || (e.button === 0 && e.altKey)) this.drag = 'rotate';
    else if (e.button === 1 || (e.button === 0 && e.shiftKey)) this.drag = 'pan';
    else return;
    e.preventDefault();
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    this.mouseInside = true;
    if (this.drag === 'none') return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    if (this.drag === 'rotate') {
      this.rig.rotate(dx * 0.0052, dy * 0.0042);
    } else {
      // Grab the ground: keep the point under the cursor attached to it.
      const [x0, y0] = this.ndc(this.lastX, this.lastY);
      const [x1, y1] = this.ndc(e.clientX, e.clientY);
      const cam = this.rig.camera;
      if (pickPlane(cam, x0, y0, this.rig.focusY, this.a) && pickPlane(cam, x1, y1, this.rig.focusY, this.b)) {
        this.rig.panWorld(this.a.x - this.b.x, this.a.z - this.b.z);
      }
    }
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.drag === 'none') return;
    this.drag = 'none';
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
  };

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

    if (this.options.edgeScroll && this.mouseInside && this.drag === 'none' && document.hasFocus()) {
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
