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
