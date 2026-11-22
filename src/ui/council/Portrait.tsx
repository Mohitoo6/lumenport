import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { Looks } from '../../game/council/ministries';
import type { Stance } from '../../game/council/schemas';
import { FaceAnimator, REST_POSE, type Pose } from './face';

/** Darkens a #rrggbb colour by a factor (0..1). */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

/** Blends two colours (#rrggbb or rgb()) by `k` toward the second. */
function mix(a: string, b: string, k: number): string {
  const rgb = (c: string): number[] =>
    c.startsWith('#') ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : (c.match(/\d+/g) ?? []).map(Number);
  const x = rgb(a);
  const y = rgb(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i]! - v) * k)).join(',')})`;
}

let uid = 0;

const EYES = [27.8, 36.2] as const;
const EYE_Y = 28;
const MOUTH_Y = 35.6;
/** The head turns and nods about the neck. */
const NECK = '32 41';

const f = (n: number): string => n.toFixed(2);

/** The SVG attributes that move, worked out from a pose (one function for both portraits). */
function geometry(p: Pose) {
  const brow = (outer: number, ctrl: number, inner: number): string => {
    const r = p.browRaise;
    const t = p.browTilt;
    return `M${outer} ${f(24.6 - r)}Q${ctrl} ${f(23.4 - r - t * 0.3)} ${inner} ${f(24.4 - r - t)}`;
  };
  const hw = 3.5 * p.mouthWide;
  const corner = MOUTH_Y - p.smile * 0.9;
  const upper = MOUTH_Y - 0.2 - p.mouthOpen * 0.6;
  const lower = MOUTH_Y + 0.2 + p.mouthOpen * 3.6;
  // A quadratic curve passes through its control point's midway mark: aim the middle of
  // each lip at `upper` and `lower`.
  const cu = 2 * upper - corner;
  const cl = 2 * lower - corner;
  const lidY = 26.3 + 3.5 * p.lid;
  return {
    head: `translate(0 ${f(p.headDrop + p.breath * 0.6)}) rotate(${f(p.headTilt)} ${NECK})`,
    body: `translate(0 ${f(p.breath)})`,
    browL: brow(26, 27.8, 29.6),
    browR: brow(38, 36.2, 34.4),
    gaze: `translate(${f(p.gazeX * 0.75)} ${f(p.gazeY * 0.5)})`,
    lid: f(3.5 * p.lid),
    lidEdge: EYES.map((x) => `M${x - 2.3} ${f(lidY)}H${x + 2.3}`),
    mouth: `M${f(32 - hw)} ${f(corner)}Q32 ${f(cu)} ${f(32 + hw)} ${f(corner)}Q32 ${f(cl)} ${f(32 - hw)} ${f(corner)}Z`,
    teethY: f(upper - 0.35),
    tongueY: f(lower + 0.35),
  };
}

/** The elements an animated portrait moves each frame. */
interface Parts {
  head?: SVGGElement | null;
  body?: SVGGElement | null;
  browL?: SVGPathElement | null;
  browR?: SVGPathElement | null;
  gaze: (SVGGElement | null)[];
  lids: (SVGRectElement | null)[];
  lidEdges: (SVGPathElement | null)[];
  mouth?: SVGPathElement | null;
  mouthClip?: SVGPathElement | null;
  lips?: SVGPathElement | null;
  teeth?: SVGRectElement | null;
  tongue?: SVGEllipseElement | null;
}

function apply(parts: Parts, p: Pose): void {
  const g = geometry(p);
  parts.head?.setAttribute('transform', g.head);
  parts.body?.setAttribute('transform', g.body);
  parts.browL?.setAttribute('d', g.browL);
  parts.browR?.setAttribute('d', g.browR);
  for (const el of parts.gaze) el?.setAttribute('transform', g.gaze);
  for (const el of parts.lids) el?.setAttribute('height', g.lid);
  parts.lidEdges.forEach((el, i) => el?.setAttribute('d', g.lidEdge[i]!));
  parts.mouth?.setAttribute('d', g.mouth);
  parts.mouthClip?.setAttribute('d', g.mouth);
  parts.lips?.setAttribute('d', g.mouth);
  parts.teeth?.setAttribute('y', g.teethY);
  parts.tongue?.setAttribute('cy', g.tongueY);
}

interface FigureProps {
  looks: Looks;
  color: string;
  size: number;
  title?: string;
  pose: Pose;
  parts?: Parts;
  /** Frame the face closely (the speaker) rather than head and shoulders. */
  close?: boolean;
}

/**
 * A flat, illustrated head-and-shoulders portrait drawn from a minister's looks, in their
 * ministry colour. Pure SVG: no image files. The face is drawn from a pose, so the same
 * drawing serves the still portraits and the animated speaker.
 */
function Figure(props: FigureProps): JSX.Element {
  const { looks: l, color, size, pose } = props;
  const parts = props.parts;
  const id = useRef(`p${uid++}`).current;
  const g = geometry(pose);
  const skinDark = shade(l.skin, 0.82);
  const hairDark = shade(l.hair, 0.8);
  const scarfColor = shade(color, 0.62);
  // Lips a little redder than the skin, so the mouth reads against a dark beard too.
  const lip = mix(shade(l.skin, 0.72), '#b4545c', 0.35);

  const hairBack: Record<Looks['hairStyle'], JSX.Element | null> = {
    long: <path d="M18.5 27C17.5 12 25.5 8.5 32 8.5S46.5 12 45.5 27L47 46 40 43V27H24V43L17 46Z" fill={l.hair} />,
    scarf: <path d="M17 29C16 13 24 9 32 9S48 13 47 29L50 52C44 47 39 45 32 45S20 47 14 52Z" fill={scarfColor} />,
    short: null,
    side: null,
    bun: <circle cx="32" cy="9.5" r="5.2" fill={l.hair} />,
    bald: null,
    curly: (
      <g fill={l.hair}>
        {[
          [21, 18],
          [25, 13],
          [31, 11],
          [37, 12],
          [42, 16],
          [44, 22],
          [20, 23],
        ].map(([x, y]) => (
          <circle cx={x} cy={y} r="5" key={`${x}${y}`} />
        ))}
      </g>
    ),
  };

  const hairFront: Record<Looks['hairStyle'], JSX.Element | null> = {
    short: <path d="M20.6 26C20 14.5 26 11.5 32 11.5S44 14.5 43.4 26C42 20 38.5 17.5 32 17.5S22 20 20.6 26Z" fill={l.hair} />,
    side: <path d="M20.6 27C19.6 14 26 11 32.5 11S44.6 14.5 43.4 26C41 19 36 16.5 29 18 25 19 22 22 20.6 27Z" fill={l.hair} />,
    long: <path d="M21 25C20.5 14.5 26 11 32 11S43.5 14.5 43 25C40 19.5 36 17 31 17.5 26 18 22.5 20.5 21 25Z" fill={l.hair} />,
    bun: <path d="M21 25.5C20.5 14.5 26 12 32 12S43.5 14.5 43 25.5C41.5 19.5 37.5 17.5 32 17.5S22.5 19.5 21 25.5Z" fill={l.hair} />,
    bald: (
      <g fill={l.hair}>
        <path d="M20.6 30C20 23 21 20 22.5 19 22 23 22.5 27 23.4 31Z" />
        <path d="M43.4 30C44 23 43 20 41.5 19 42 23 41.5 27 40.6 31Z" />
      </g>
    ),
    scarf: <path d="M20 24C21 15 26 12 32 12S43 15 44 24C41 18 37 16 32 16S23 18 20 24Z" fill={shade(color, 0.75)} />,
    curly: <path d="M21 24C21 17 26 14 32 14S43 17 43 24C40 20 36 19 32 19S24 20 21 24Z" fill={l.hair} />,
  };

  return (
    <svg width={size} height={size} viewBox={props.close ? '12.5 8.5 39 39' : '0 0 64 64'} class="portrait" role="img" aria-label={props.title} focusable="false">
      <defs>
        <clipPath id={`${id}c`}>
          <circle cx="32" cy="32" r="32" />
        </clipPath>
        <radialGradient id={`${id}g`} cx="0.35" cy="0.25" r="0.9">
          <stop offset="0" stop-color={color} stop-opacity="0.55" />
          <stop offset="1" stop-color={color} stop-opacity="0.12" />
        </radialGradient>
        {EYES.map((x, i) => (
          <clipPath id={`${id}e${i}`} key={x}>
            <ellipse cx={x} cy={EYE_Y} rx="2.05" ry="1.6" />
          </clipPath>
        ))}
        <clipPath id={`${id}m`}>
          <path d={g.mouth} ref={parts && ((el) => void (parts.mouthClip = el))} />
        </clipPath>
      </defs>
      <g clip-path={`url(#${id}c)`}>
        <rect width="64" height="64" fill="#161c24" />
        <rect width="64" height="64" fill={`url(#${id}g)`} />
        <g transform={g.body} ref={parts && ((el) => void (parts.body = el))}>
          {/* Shoulders, collar, tie and neck. */}
          <path d="M5 66C7 51 17 45.5 32 45.5S57 51 59 66Z" fill={l.outfit} />
          <path d="M5 66C7 51 17 45.5 32 45.5S57 51 59 66Z" fill={color} opacity="0.18" />
          <path d="M25.5 46.5 32 57 38.5 46.5 35 45H29Z" fill="#ece7df" />
          <path d="M30.6 49 32 58 33.4 49 32 47.6Z" fill={shade(color, 0.7)} />
          <rect x="27" y="35" width="10" height="12" rx="4" fill={skinDark} />
        </g>
        <g transform={g.head} ref={parts && ((el) => void (parts.head = el))}>
          {hairBack[l.hairStyle]}
          <ellipse cx="20.8" cy="28.5" rx="2.2" ry="3.4" fill={skinDark} />
          <ellipse cx="43.2" cy="28.5" rx="2.2" ry="3.4" fill={skinDark} />
          <ellipse cx="32" cy="27.5" rx="11.2" ry="13.2" fill={l.skin} />
          {l.beard && <path d="M21.4 28C21.8 39.5 27 42.5 32 42.5S42.2 39.5 42.6 28C41.4 34 37.5 37.2 32 37.2S22.6 34 21.4 28Z" fill={hairDark} />}
          {hairFront[l.hairStyle]}
          {/* Eyes: whites, iris and pupil (which look around), and an upper lid that blinks. */}
          {EYES.map((x, i) => (
            <g key={x}>
              <g clip-path={`url(#${id}e${i})`}>
                <ellipse cx={x} cy={EYE_Y} rx="2.05" ry="1.6" fill="#f3eee6" />
                <g transform={g.gaze} ref={parts && ((el) => void (parts.gaze[i] = el))}>
                  <circle cx={x} cy={EYE_Y} r="1.15" fill="#3b281d" />
                  <circle cx={x} cy={EYE_Y} r="0.58" fill="#0d0a08" />
                  <circle cx={x + 0.4} cy={EYE_Y - 0.42} r="0.33" fill="#fff" />
                </g>
                <rect x={x - 2.3} y="26.3" width="4.6" height={g.lid} fill={l.skin} ref={parts && ((el) => void (parts.lids[i] = el))} />
                <path d={g.lidEdge[i]} stroke={shade(l.skin, 0.6)} stroke-width="0.45" ref={parts && ((el) => void (parts.lidEdges[i] = el))} />
              </g>
              <path d={`M${x - 2.2} 27.7Q${x} 25.2 ${x + 2.2} 27.7`} stroke="#1b1714" stroke-width="0.6" fill="none" stroke-linecap="round" />
            </g>
          ))}
          <path d={g.browL} stroke={hairDark} stroke-width="1.25" fill="none" stroke-linecap="round" ref={parts && ((el) => void (parts.browL = el))} />
          <path d={g.browR} stroke={hairDark} stroke-width="1.25" fill="none" stroke-linecap="round" ref={parts && ((el) => void (parts.browR = el))} />
          <path d="M32 29.5V32.4L30.8 33" stroke={skinDark} stroke-width="1" fill="none" stroke-linecap="round" />
          {/* Mouth: the opening, with teeth and tongue showing through it. */}
          <path d={g.mouth} fill="#5b1d22" ref={parts && ((el) => void (parts.mouth = el))} />
          <g clip-path={`url(#${id}m)`}>
            <rect x="27.5" y={g.teethY} width="9" height="1.15" rx="0.4" fill="#eee8de" ref={parts && ((el) => void (parts.teeth = el))} />
            <ellipse cx="32" cy={g.tongueY} rx="2.3" ry="1.15" fill="#a3454b" ref={parts && ((el) => void (parts.tongue = el))} />
          </g>
          <path d={g.mouth} fill="none" stroke={lip} stroke-width="1.05" stroke-linejoin="round" ref={parts && ((el) => void (parts.lips = el))} />
          {l.glasses && (
            <g stroke="#2a2a2e" stroke-width="1" fill="rgba(200,220,255,0.12)">
              <rect x="23.6" y="25.4" width="8.2" height="5.4" rx="2.2" />
              <rect x="32.2" y="25.4" width="8.2" height="5.4" rx="2.2" />
              <path d="M31.8 27.6H32.2" />
            </g>
          )}
        </g>
      </g>
    </svg>
  );
}

/** A still portrait, for name plates, lists and chips. */
export function Portrait(props: { looks: Looks; color: string; size?: number; title?: string }): JSX.Element {
  return <Figure looks={props.looks} color={props.color} size={props.size ?? 56} title={props.title} pose={REST_POSE} />;
}

/**
 * The minister who has the floor: blinks, looks around, shows their stance on their face,
 * and moves their lips with the statement as its subtitle is typed out over `seconds`.
 * Animated by setting SVG attributes every frame, not by re-rendering.
 */
export function LivePortrait(props: { looks: Looks; color: string; size: number; title?: string; text: string; seconds: number; stance: Stance }): JSX.Element {
  const parts = useRef<Parts>({ gaze: [], lids: [], lidEdges: [] }).current;
  const { text, seconds, stance } = props;
  useEffect(() => {
    const face = new FaceAnimator();
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let last = start;
    let frame = 0;
    const tick = (now: number): void => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      apply(parts, face.step(dt, { t: (now - start) / 1000, text, duration: seconds, stance, reduced }));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, seconds, stance]);
  return <Figure looks={props.looks} color={props.color} size={props.size} title={props.title} pose={REST_POSE} parts={parts} close />;
}
