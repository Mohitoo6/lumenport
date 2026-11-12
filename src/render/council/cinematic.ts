import { Vector3, type PerspectiveCamera } from 'three';
import type { DoorFrame, TownHallDoors } from '../buildings/townHallDoors';

/**
 * The walk into the council: the camera leaves the mayor's view of the city, swings round
 * to the town hall, closes in on the front doors, the doors swing open and the view fades
 * into the chamber. Leaving plays it backwards. Clicking during the approach skips it.
 */

export type CinePhase = 'off' | 'enter' | 'inside' | 'exit';

interface Key {
  pos: Vector3;
  look: Vector3;
}

const ease = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const span = (t: number, a: number, b: number): number => Math.max(0, Math.min(1, (t - a) / (b - a)));

// Entrance timeline, seconds.
const FLY_END = 2.6;
const CLOSE_END = 4.2;
const DOOR_START = 3.9;
const DOOR_END = 5.3;
const THROUGH_START = 4.9;
const FADE_START = 5.3;
const SWITCH = 5.9;
const ENTER_END = 6.5;
// Exit timeline.
const X_SWITCH = 0.45;
const X_FADE_END = 0.9;
const X_DOOR_END = 2.1;
const X_BACK_END = 2.9;
const X_END = 5.0;

export class Cinematic {
  phase: CinePhase = 'off';
  /** True while the chamber rather than the city should be drawn. */
  inside = false;
  /** Distance from the camera to what it looks at, for fitting city shadows. */
  focusDist = 100;
  lookY = 0;
  /** Called when the view crosses into or out of the chamber. */
  onInside: () => void = () => {};
  onPhase: (p: CinePhase) => void = () => {};

  private t = 0;
  private frame: DoorFrame | null = null;
  private readonly saved: Key = { pos: new Vector3(), look: new Vector3() };
  private readonly est: Key = { pos: new Vector3(), look: new Vector3() };
  private readonly close: Key = { pos: new Vector3(), look: new Vector3() };
  private readonly through: Key = { pos: new Vector3(), look: new Vector3() };
  private readonly back: Key = { pos: new Vector3(), look: new Vector3() };
  private readonly pos = new Vector3();
  private readonly look = new Vector3();
  private readonly el: HTMLDivElement;
  private readonly fade: HTMLDivElement;

  constructor(
    container: HTMLElement,
    private readonly doors: TownHallDoors,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'cine';
    this.el.innerHTML = '<div class="cine-bar top"></div><div class="cine-bar bottom"></div><div class="cine-skip">Click to skip</div>';
    this.fade = document.createElement('div');
    this.fade.className = 'cine-fade';
    this.el.appendChild(this.fade);
    this.el.addEventListener('pointerdown', () => this.skip());
    container.appendChild(this.el);
  }

  /** Seconds into the current phase (for scripted screenshot runs). */
  get time(): number {
    return this.t;
  }

  /** Starts the entrance from the current city view. `frame` is null if the city has no town hall. */
  enter(frame: DoorFrame | null, camera: PerspectiveCamera, look: Vector3): void {
    this.frame = frame;
    this.saved.pos.copy(camera.position);
    this.saved.look.copy(look);
    if (frame) this.keys(frame);
    this.t = 0;
    this.inside = false;
    this.setPhase('enter');
  }

  /** Leaves the chamber and returns to the saved city view. */
  exit(): void {
    if (this.phase === 'off') return;
    if (this.phase === 'enter' && !this.inside) {
      // Never got inside: just put the camera back.
      this.finish();
      return;
    }
    this.t = 0;
    this.setPhase('exit');
  }

  /** Jumps to the moment of fading into the chamber. */
  skip(): void {
    if (this.phase === 'enter' && this.t < FADE_START) this.t = FADE_START;
  }

  private setPhase(p: CinePhase): void {
    this.phase = p;
    this.el.classList.toggle('is-on', p === 'enter' || p === 'exit');
    this.el.classList.toggle('can-skip', p === 'enter');
    this.onPhase(p);
  }

  private keys(f: DoorFrame): void {
    const out = new Vector3(f.outX, 0, f.outZ);
    const right = new Vector3(f.outZ, 0, -f.outX);
    const door = new Vector3(f.x, f.y, f.z);
    this.est.pos.copy(door).addScaledVector(out, 62).addScaledVector(right, 24);
    this.est.pos.y += 24;
    this.est.look.copy(door).addScaledVector(out, -8);
    this.est.look.y += 5;
    this.close.pos.copy(door).addScaledVector(out, 19).addScaledVector(right, 2.5);
    this.close.pos.y += 3.4;
    this.close.look.copy(door);
    this.close.look.y += 2.4;
    this.through.pos.copy(door).addScaledVector(out, 1.2);
    this.through.pos.y += 2.2;
    this.through.look.copy(door).addScaledVector(out, -6);
    this.through.look.y += 2.0;
    this.back.pos.copy(door).addScaledVector(out, 7);
    this.back.pos.y += 2.5;
    this.back.look.copy(door);
    this.back.look.y += 2.4;
  }

  private blend(a: Key, b: Key, t: number): void {
    const e = ease(t);
    this.pos.lerpVectors(a.pos, b.pos, e);
    this.look.lerpVectors(a.look, b.look, e);
  }

  private finish(): void {
    this.inside = false;
    this.doors.setOpen(0);
    this.fade.style.opacity = '0';
    this.setPhase('off');
  }

  /**
   * Advances the sequence. While it returns true the cinematic owns the city camera and
   * has positioned it.
   */
  update(dt: number, camera: PerspectiveCamera): boolean {
    if (this.phase === 'off') return false;
    this.t += dt;
    const t = this.t;
    const f = this.frame;
    let fade = 0;
    if (this.phase === 'enter') {
      if (f) {
        if (t < FLY_END) this.blend(this.saved, this.est, span(t, 0, FLY_END));
        else if (t < THROUGH_START) this.blend(this.est, this.close, span(t, FLY_END, CLOSE_END));
        else this.blend(this.close, this.through, span(t, THROUGH_START, SWITCH));
        this.doors.setOpen(span(t, DOOR_START, DOOR_END));
        fade = t < SWITCH ? span(t, FADE_START, SWITCH) : 1 - span(t, SWITCH, ENTER_END);
        if (t >= SWITCH && !this.inside) {
          this.inside = true;
          this.onInside();
        }
      } else {
        // No town hall: a plain fade into the chamber.
        this.pos.copy(this.saved.pos);
        this.look.copy(this.saved.look);
        fade = t < 0.5 ? span(t, 0, 0.5) : 1 - span(t, 0.5, 1);
        if (t >= 0.5 && !this.inside) {
          this.inside = true;
          this.onInside();
        }
      }
      if (t >= (f ? ENTER_END : 1)) {
        this.setPhase('inside');
        fade = 0;
      }
    } else if (this.phase === 'exit') {
      if (t < X_SWITCH) {
        fade = span(t, 0, X_SWITCH);
      } else {
        if (this.inside) {
          this.inside = false;
          this.onInside();
          this.doors.setOpen(1);
        }
        fade = 1 - span(t, X_SWITCH, X_FADE_END);
        if (f) {
          this.doors.setOpen(1 - span(t, X_FADE_END, X_DOOR_END));
          if (t < X_FADE_END) this.blend(this.back, this.back, 1);
          else if (t < X_BACK_END) this.blend(this.back, this.est, span(t, X_FADE_END, X_BACK_END));
          else this.blend(this.est, this.saved, span(t, X_BACK_END, X_END));
          if (t >= X_END) this.finish();
        } else {
          this.pos.copy(this.saved.pos);
          this.look.copy(this.saved.look);
          if (t >= X_FADE_END) this.finish();
        }
      }
    }
    this.fade.style.opacity = fade.toFixed(3);
    // finish() may have ended the sequence during this frame.
    if ((this.phase as CinePhase) === 'off') return false;
    if (this.inside && this.phase !== 'exit') return true;
    camera.position.copy(this.pos);
    camera.lookAt(this.look);
    camera.near = 0.5;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    this.focusDist = Math.max(20, this.pos.distanceTo(this.look));
    this.lookY = this.look.y;
    return true;
  }
}
