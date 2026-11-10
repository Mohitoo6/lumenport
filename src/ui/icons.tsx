import type { JSX } from 'preact';

type P = { size?: number };

function Svg({ size = 16, children }: P & { children: JSX.Element | JSX.Element[] }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const IconPause = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M5.5 3.5v9M10.5 3.5v9" stroke-width="2.2" />
  </Svg>
);

const tri = (x: number): string => `M${x} 4.2l5 3.8-5 3.8z`;

export const IconPlay = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d={tri(5.5)} fill="currentColor" />
  </Svg>
);

export const IconFast = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d={tri(2.5)} fill="currentColor" />
    <path d={tri(8.5)} fill="currentColor" />
  </Svg>
);

export const IconFaster = (p: P): JSX.Element => (
  <svg width={(p.size ?? 16) * 1.25} height={p.size ?? 16} viewBox="0 0 20 16" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
    <path d="M1.5 4.2l5 3.8-5 3.8z" />
    <path d="M7.5 4.2l5 3.8-5 3.8z" />
    <path d="M13.5 4.2l5 3.8-5 3.8z" />
  </svg>
);

export const IconClose = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);

export const IconHelp = (p: P): JSX.Element => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M6.3 6.3a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.7-.9 1.3M8 11.4v.1" />
  </Svg>
);

export const IconRoad = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M5.2 2.2L3 13.8M10.8 2.2L13 13.8" />
    <path d="M8 3v2M8 7v2M8 11v2" />
  </Svg>
);

export const IconAvenue = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M3.6 2.2L1.6 13.8M12.4 2.2l2 11.6" />
    <path d="M8 2.6v10.8" stroke-width="2.4" />
  </Svg>
);

export const IconStraight = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M3 13L13 3" />
    <circle cx="3" cy="13" r="1.3" fill="currentColor" />
    <circle cx="13" cy="3" r="1.3" fill="currentColor" />
  </Svg>
);

export const IconCurve = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M3 13C3 7 7 3 13 3" />
    <circle cx="3" cy="13" r="1.3" fill="currentColor" />
    <circle cx="13" cy="3" r="1.3" fill="currentColor" />
  </Svg>
);

export const IconBulldoze = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M2 11.5h7.5V8L7.5 5H4v6.5M9.5 9.5h2.2l2.3 3.3H2" />
    <path d="M4.2 13.6h6.6" stroke-width="2" />
  </Svg>
);
