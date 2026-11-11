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

export const IconHome = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M2.2 7.6L8 2.6l5.8 5M3.8 6.6v6.6h8.4V6.6" />
    <path d="M6.8 13.2V9.6h2.4v3.6" />
  </Svg>
);

export const IconShop = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M2.4 6.2l1-3.4h9.2l1 3.4M3.2 6.6v6.6h9.6V6.6" />
    <path d="M2.4 6.2c0 1 .8 1.6 1.8 1.6S6 7.200 6 6.2c0 1 .9 1.6 2 1.6s2-.6 2-1.600c0 1 .8 1.600 1.800 1.600s1.800-.6 1.800-1.600" />
  </Svg>
);

export const IconFactory = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M2.2 13.4V7.6l3.600 2.200V7.6l3.600 2.200V3h2.600l.6 10.400z" />
  </Svg>
);

export const IconErase = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M6.2 13.200L2.6 9.600l6.600-6.600 4.200 4.200-6 6zM6.200 13.200h7M5.800 6.400l4.200 4.200" />
  </Svg>
);

export const IconBolt = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M9 1.800L3.600 9h4l-.8 5.200L12.400 7h-4z" />
  </Svg>
);

export const IconDrop = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M8 2c2.400 3 4 5 4 7.200a4 4 0 0 1-8 0C4 7 5.600 5 8 2z" />
  </Svg>
);

export const IconChart = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M2.600 13.400h10.800M4.600 11V7.600M8 11V4M11.400 11V6" stroke-width="1.800" />
  </Svg>
);

export const IconWarn = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M8 2.400l6 10.600H2zM8 6.600v3M8 11.400v.1" />
  </Svg>
);

export const IconShield = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M8 1.800l5 1.800v4.200c0 3-2 5.200-5 6.400-3-1.200-5-3.400-5-6.400V3.600z" />
    <path d="M8 5.600v4.400M5.800 7.800h4.400" />
  </Svg>
);

export const IconLayers = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M8 2.200l6 3.200-6 3.200-6-3.200zM2.600 8.200L8 11l5.400-2.800M2.600 10.800L8 13.600l5.400-2.800" />
  </Svg>
);
