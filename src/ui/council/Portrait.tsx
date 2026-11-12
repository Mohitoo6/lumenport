import type { JSX } from 'preact';
import type { Looks } from '../../game/council/ministries';

/** Darkens a #rrggbb colour by a factor (0..1). */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

let uid = 0;

/**
 * A flat, illustrated head-and-shoulders portrait drawn from a minister's looks, in their
 * ministry colour. Pure SVG: no image files.
 */
export function Portrait(props: { looks: Looks; color: string; size?: number; title?: string }): JSX.Element {
  const { looks: l, color, size = 56 } = props;
  const id = `p${uid++}`;
  const skinDark = shade(l.skin, 0.82);
  const hairDark = shade(l.hair, 0.8);
  const scarfColor = shade(color, 0.62);

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
    <svg width={size} height={size} viewBox="0 0 64 64" class="portrait" role="img" aria-label={props.title} focusable="false">
      <defs>
        <clipPath id={`${id}c`}>
          <circle cx="32" cy="32" r="32" />
        </clipPath>
        <radialGradient id={`${id}g`} cx="0.35" cy="0.25" r="0.9">
          <stop offset="0" stop-color={color} stop-opacity="0.55" />
          <stop offset="1" stop-color={color} stop-opacity="0.12" />
        </radialGradient>
      </defs>
      <g clip-path={`url(#${id}c)`}>
        <rect width="64" height="64" fill="#161c24" />
        <rect width="64" height="64" fill={`url(#${id}g)`} />
        {hairBack[l.hairStyle]}
        {/* Shoulders and collar. */}
        <path d="M5 66C7 51 17 45.5 32 45.5S57 51 59 66Z" fill={l.outfit} />
        <path d="M5 66C7 51 17 45.5 32 45.5S57 51 59 66Z" fill={color} opacity="0.18" />
        <path d="M25.5 46.5 32 57 38.5 46.5 35 45H29Z" fill="#ece7df" />
        <path d="M30.6 49 32 58 33.4 49 32 47.6Z" fill={shade(color, 0.7)} />
        <rect x="27" y="35" width="10" height="12" rx="4" fill={skinDark} />
        <ellipse cx="20.8" cy="28.5" rx="2.2" ry="3.4" fill={skinDark} />
        <ellipse cx="43.2" cy="28.5" rx="2.2" ry="3.4" fill={skinDark} />
        <ellipse cx="32" cy="27.5" rx="11.2" ry="13.2" fill={l.skin} />
        {l.beard && <path d="M21.4 28C21.8 39.5 27 42.5 32 42.5S42.2 39.5 42.6 28C41.4 34 37.5 37.2 32 37.2S22.6 34 21.4 28Z" fill={hairDark} />}
        {hairFront[l.hairStyle]}
        {/* Face. */}
        <path d="M26 24.6Q27.8 23.4 29.6 24.4M34.4 24.4Q36.2 23.4 38 24.6" stroke={hairDark} stroke-width="1.2" fill="none" stroke-linecap="round" />
        <circle cx="27.8" cy="28" r="1.25" fill="#1b1714" />
        <circle cx="36.2" cy="28" r="1.25" fill="#1b1714" />
        <path d="M32 29.5V32.4L30.8 33" stroke={skinDark} stroke-width="1" fill="none" stroke-linecap="round" />
        <path d="M28.8 35.3Q32 37.4 35.2 35.3" stroke={shade(l.skin, 0.55)} stroke-width="1.15" fill="none" stroke-linecap="round" />
        {l.glasses && (
          <g stroke="#2a2a2e" stroke-width="1" fill="rgba(200,220,255,0.12)">
            <rect x="23.6" y="25.4" width="8.2" height="5.4" rx="2.2" />
            <rect x="32.2" y="25.4" width="8.2" height="5.4" rx="2.2" />
            <path d="M31.8 27.6H32.2" />
          </g>
        )}
      </g>
    </svg>
  );
}
