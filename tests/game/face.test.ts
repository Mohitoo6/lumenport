import { describe, expect, it } from 'vitest';
import { EXPRESSIONS, FaceAnimator, VISEMES, visemeAt } from '../../src/ui/council/face';

/** A seeded random source, so blinks and glances repeat exactly. */
function seeded(seed = 7): () => number {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Runs a face at 60 frames a second and records every pose. */
function run(text: string, seconds: number, stance: keyof typeof EXPRESSIONS = 'neutral', duration = text.length / 15) {
  const face = new FaceAnimator(seeded());
  const poses = [];
  for (let i = 0; i < seconds * 60; i++) poses.push(face.step(1 / 60, { t: i / 60, text, duration, stance }));
  return poses;
}

describe('lip shapes from the subtitle text', () => {
  it('reads English letters', () => {
    expect(visemeAt('Mayor', 0)).toBe(VISEMES.closed);
    expect(visemeAt('Mayor', 1)).toBe(VISEMES.aa);
    expect(visemeAt('see', 1)).toBe(VISEMES.ee);
    expect(visemeAt('too', 2)).toBe(VISEMES.oo);
    expect(visemeAt('five', 0)).toBe(VISEMES.fv);
    expect(visemeAt('a b', 1)).toBe(VISEMES.rest);
    expect(visemeAt('end.', 3)).toBe(VISEMES.rest);
  });

  it('reads Hindi (Devanagari), including vowel signs and the inherent "a"', () => {
    expect(visemeAt('मेयर', 0)).toBe(VISEMES.closed);
    expect(visemeAt('सड़क', 0)).toBe(VISEMES.consA);
    // "की": the consonant takes the shape of the "ee" sign after it.
    expect(visemeAt('की', 0)).toBe(VISEMES.ee);
    expect(visemeAt('को', 1)).toBe(VISEMES.oo);
    expect(visemeAt('आप', 0)).toBe(VISEMES.aa);
    expect(visemeAt('है।', 2)).toBe(VISEMES.rest);
  });
});

describe('the animated face', () => {
  it('moves its mouth while the statement is typed, then closes it', () => {
    const text = 'Mayor, I propose option D, staggered office hours.';
    const poses = run(text, 6);
    const speaking = poses.slice(0, Math.floor((text.length / 15) * 60));
    const after = poses.slice(-30);
    const opens = speaking.map((p) => p.mouthOpen);
    expect(Math.max(...opens)).toBeGreaterThan(0.6);
    // It closes too (m, b, p and the gaps between words), not just flaps open.
    expect(Math.min(...opens.slice(10))).toBeLessThan(0.15);
    expect(Math.max(...after.map((p) => p.mouthOpen))).toBeLessThan(0.02);
  });

  it('blinks every few seconds, fully closing the eyes', () => {
    const poses = run('', 20);
    let blinks = 0;
    for (let i = 1; i < poses.length; i++) if (poses[i]!.lid > 0.9 && poses[i - 1]!.lid <= 0.9) blinks++;
    expect(blinks).toBeGreaterThanOrEqual(3);
    expect(blinks).toBeLessThanOrEqual(12);
  });

  it('shows the stance: a smile in support, a frown and lowered brows in objection', () => {
    const support = run('', 3, 'support').at(-1)!;
    const oppose = run('', 3, 'oppose').at(-1)!;
    const concern = run('', 3, 'concern').at(-1)!;
    expect(support.smile).toBeGreaterThan(0.5);
    expect(oppose.smile).toBeLessThan(-0.3);
    expect(oppose.browTilt).toBeLessThan(-0.6);
    expect(concern.browTilt).toBeGreaterThan(0.6);
  });

  it('glances away and comes back to the viewer', () => {
    const poses = run('', 15);
    expect(Math.max(...poses.map((p) => Math.abs(p.gazeX)))).toBeGreaterThan(0.3);
    expect(poses.filter((p) => Math.abs(p.gazeX) < 0.05).length).toBeGreaterThan(poses.length / 3);
  });

  it('nods as a sentence ends', () => {
    const text = 'Traffic is bad. We must act now.';
    const poses = run(text, 4);
    const fullStop = Math.floor((text.indexOf('.') / text.length) * (text.length / 15) * 60);
    const nod = Math.max(...poses.slice(fullStop, fullStop + 30).map((p) => p.headDrop));
    expect(nod).toBeGreaterThan(0.7);
  });

  it('keeps the head still when motion is reduced', () => {
    const face = new FaceAnimator(seeded());
    for (let i = 0; i < 300; i++) {
      const p = face.step(1 / 60, { t: i / 60, text: 'Hello there. Again.', duration: 1.3, stance: 'neutral', reduced: true });
      expect(p.headTilt).toBe(0);
      expect(p.headDrop).toBe(0);
      expect(p.breath).toBe(0);
    }
  });
});
