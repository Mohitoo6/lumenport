/**
 * A speaking face, as numbers: where the eyelids, eyes, brows, mouth and head are at each
 * moment. The portrait (Portrait.tsx) turns a pose into SVG; this file decides the pose.
 *
 * No audio is involved. The game shows a statement as a subtitle typed out at the pace it
 * would be spoken, so the mouth follows the letter being typed: a vowel opens it, "m", "b"
 * and "p" close it, a space or a full stop rests it. English and Hindi (Devanagari) are
 * both read. Everything else (blinks, glances, nods at the end of a sentence, a brow raised
 * on a long word) is timed by a random source, which tests can replace.
 */

import type { Stance } from '../../game/council/schemas';

/** A mouth shape: how far open (0..1) and how wide (1 is relaxed; under 1 is rounded). */
export interface Mouth {
  open: number;
  wide: number;
}

export const VISEMES = {
  rest: { open: 0, wide: 1 },
  aa: { open: 1, wide: 1.05 },
  ee: { open: 0.42, wide: 1.22 },
  oo: { open: 0.62, wide: 0.66 },
  /** m, b, p: lips pressed together. */
  closed: { open: 0, wide: 0.94 },
  /** f, v: lower lip to the teeth. */
  fv: { open: 0.16, wide: 1.04 },
  /** Most consonants: slightly open. */
  cons: { open: 0.3, wide: 1.04 },
  /** A Devanagari consonant carries the vowel "a" unless a sign says otherwise. */
  consA: { open: 0.55, wide: 1.04 },
} as const satisfies Record<string, Mouth>;

const SENTENCE_END = /[.!?।]/;

/** The mouth shape for the letter at `i` in `text`. */
export function visemeAt(text: string, i: number): Mouth {
  const c = (text[i] ?? ' ').toLowerCase();
  if (/[aáà]/.test(c)) return VISEMES.aa;
  if (/[eiyé]/.test(c)) return VISEMES.ee;
  if (/[ouw]/.test(c)) return VISEMES.oo;
  if (/[mbp]/.test(c)) return VISEMES.closed;
  if (/[fv]/.test(c)) return VISEMES.fv;
  if (/[a-z0-9$]/.test(c)) return VISEMES.cons;
  if (/[।॥]/.test(c)) return VISEMES.rest;
  // Devanagari: vowels and vowel signs first, then the lip consonants.
  if (/[अआा]/.test(c)) return VISEMES.aa;
  if (/[इईएऐिीेैृ]/.test(c)) return VISEMES.ee;
  if (/[उऊओऔुूोौ]/.test(c)) return VISEMES.oo;
  if (/[पफबभम]/.test(c)) return VISEMES.closed;
  if (c === 'व') return VISEMES.fv;
  if (/[ंँः़्]/.test(c)) return VISEMES.cons;
  if (/[ऀ-ॿ]/.test(c)) {
    // A consonant followed by a vowel sign takes that sign's shape a moment early.
    const next = text[i + 1] ?? '';
    if (/[ािीुूेैोौृ्]/.test(next)) return visemeAt(text, i + 1);
    return VISEMES.consA;
  }
  return VISEMES.rest;
}

/** How a stance shows on the face when the minister is not talking. */
export interface Expression {
  /** Mouth corners: up is positive. */
  smile: number;
  /** Both brows up (surprise, interest) or down. */
  browRaise: number;
  /** Inner ends of the brows up (worry) or down (anger). */
  browTilt: number;
  /** Upper lids lowered at rest, 0 wide open to 1 closed. */
  lid: number;
}

export const EXPRESSIONS: Record<Stance, Expression> = {
  propose: { smile: 0.35, browRaise: 0.35, browTilt: 0, lid: 0.12 },
  support: { smile: 0.7, browRaise: 0.25, browTilt: 0.1, lid: 0.16 },
  concern: { smile: -0.3, browRaise: 0.15, browTilt: 0.75, lid: 0.06 },
  oppose: { smile: -0.45, browRaise: -0.25, browTilt: -0.8, lid: 0.3 },
  neutral: { smile: 0.1, browRaise: 0, browTilt: 0, lid: 0.15 },
};

export interface Pose {
  /** Upper lid, 0 open to 1 closed. */
  lid: number;
  /** Where the eyes look, -1..1 each way (0, 0 is at the viewer). */
  gazeX: number;
  gazeY: number;
  mouthOpen: number;
  mouthWide: number;
  smile: number;
  browRaise: number;
  browTilt: number;
  /** Head roll in degrees, and its drop in face units (a nod). */
  headTilt: number;
  headDrop: number;
  /** Chest and shoulders rising with breath, in face units. */
  breath: number;
}

export const REST_POSE: Pose = {
  lid: EXPRESSIONS.neutral.lid,
  gazeX: 0,
  gazeY: 0,
  mouthOpen: 0,
  mouthWide: 1,
  smile: EXPRESSIONS.neutral.smile,
  browRaise: 0,
  browTilt: 0,
  headTilt: 0,
  headDrop: 0,
  breath: 0,
};

export interface FaceInput {
  /** Seconds since the statement began. */
  t: number;
  /** The statement, and how long it takes to type out (0: not speaking). */
  text: string;
  duration: number;
  stance: Stance;
  /** Honour "reduce motion": no head movement or breathing. */
  reduced?: boolean;
}

/** Moves `cur` towards `goal` at `rate` per second, independent of the frame rate. */
function damp(cur: number, goal: number, rate: number, dt: number): number {
  return cur + (goal - cur) * (1 - Math.exp(-rate * dt));
}

const between = (r: () => number, lo: number, hi: number): number => lo + (hi - lo) * r();

/** Drives one face over time. Call `step` every frame. */
export class FaceAnimator {
  private readonly rand: () => number;
  private readonly pose: Pose = { ...REST_POSE };
  private clock = 0;
  private nextBlink: number;
  private blinkAt = -1;
  private nextGlance: number;
  private glanceUntil = -1;
  private glance = { x: 0, y: 0 };
  private lastIndex = -1;
  private nodAt = -10;
  private flickAt = -10;

  constructor(rand: () => number = Math.random) {
    this.rand = rand;
    this.nextBlink = between(rand, 0.6, 2.5);
    this.nextGlance = between(rand, 2, 4);
  }

  step(dt: number, input: FaceInput): Pose {
    const r = this.rand;
    const p = this.pose;
    const now = (this.clock += dt);
    const expr = EXPRESSIONS[input.stance];

    // Where the speech has got to.
    const k = input.duration > 0 ? input.t / input.duration : 1;
    const speaking = k < 1 && input.text.length > 0;
    const index = speaking ? Math.floor(k * input.text.length) : -1;
    if (index !== this.lastIndex && index >= 0) {
      const prev = input.text[index - 1] ?? '';
      // A nod as a sentence ends; now and then a brow lifts at the start of a long word.
      if (SENTENCE_END.test(input.text[index] ?? '')) this.nodAt = now;
      if (prev === ' ' && /^\S{7,}/.test(input.text.slice(index)) && r() < 0.4) this.flickAt = now;
      this.lastIndex = index;
    }

    // Mouth: the shape of the letter being said, with a quick but not instant change.
    const target = speaking ? visemeAt(input.text, index) : VISEMES.rest;
    p.mouthOpen = damp(p.mouthOpen, target.open, 24, dt);
    p.mouthWide = damp(p.mouthWide, target.wide, 16, dt);
    p.smile = damp(p.smile, expr.smile * (speaking ? 0.45 : 1), 4, dt);

    // Brows: the stance, a raise on a question, and the occasional flick.
    const question = speaking && input.text.slice(index, index + 25).includes('?') ? 0.3 : 0;
    const flick = Math.max(0, Math.sin(Math.min(1, (now - this.flickAt) / 0.45) * Math.PI)) * 0.55;
    p.browRaise = damp(p.browRaise, expr.browRaise + question + flick, 10, dt);
    p.browTilt = damp(p.browTilt, expr.browTilt, 5, dt);

    // Blinks every few seconds, sometimes twice.
    if (now >= this.nextBlink) {
      this.blinkAt = now;
      this.nextBlink = now + (r() < 0.2 ? 0.28 : between(r, 2.2, 5.5));
    }
    const b = (now - this.blinkAt) / 0.16;
    const blink = b >= 0 && b <= 1 ? Math.sin(b * Math.PI) : 0;
    p.lid = Math.max(damp(p.lid, expr.lid, 6, dt), blink);

    // Eyes: mostly on the mayor, with short glances away (fewer while talking).
    if (now >= this.nextGlance) {
      this.glance = { x: between(r, -1, 1), y: between(r, -0.6, 0.5) };
      this.glanceUntil = now + between(r, 0.4, 1.1);
      this.nextGlance = now + (speaking ? between(r, 3.5, 7) : between(r, 2, 4.5));
    }
    const away = now < this.glanceUntil;
    p.gazeX = damp(p.gazeX, away ? this.glance.x : 0, 20, dt);
    p.gazeY = damp(p.gazeY, away ? this.glance.y : 0, 20, dt);

    // Head and chest.
    const n = (now - this.nodAt) / 0.5;
    const nod = n >= 0 && n <= 1 ? Math.sin(n * Math.PI) : 0;
    const moving = !input.reduced;
    p.headTilt = moving ? Math.sin(now * 0.55) * 1.6 + (speaking ? Math.sin(now * 2.3) * 1.2 : 0) : 0;
    p.headDrop = moving ? nod * 1.1 + p.mouthOpen * 0.25 : 0;
    p.breath = moving ? Math.sin((now * Math.PI * 2) / 4.2) * 0.35 : 0;
    return { ...p };
  }
}
