import type { JSX } from 'preact';
import { ui } from './store';

/** The game's name, in English and in Devanagari. */
export const GAME_NAME = 'Mahanagar';
export const GAME_NAME_HI = 'महानगर';

/** The loading stages Game.init reports, in order: the bar fills by stage. */
const STAGES = ['Loading sky and terrain', 'Loading building materials', 'Building the landscape'];

/** Skyline buildings in a 360 by 130 box, ground at y = 118: [x, width, height]. */
const TOWERS: ReadonlyArray<readonly [number, number, number]> = [
  [8, 22, 34],
  [32, 16, 58],
  [50, 26, 44],
  [80, 14, 78],
  [96, 30, 52],
  [130, 20, 92],
  [192, 18, 70],
  [214, 28, 48],
  [246, 16, 84],
  [266, 32, 40],
  [302, 20, 62],
  [326, 26, 30],
];

/** A deterministic scatter of 0..1, so the windows light in the same order every visit. */
const scatter = (i: number): number => {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

function Skyline(): JSX.Element {
  const windows: JSX.Element[] = [];
  let n = 0;
  TOWERS.forEach(([x, w, h], t) => {
    for (let y = 118 - h + 6; y < 112; y += 8) {
      for (let wx = x + 4; wx < x + w - 4; wx += 7) {
        if (scatter(n * 3 + t) < 0.42) {
          n++;
          continue;
        }
        const delay = 1.1 + scatter(n) * 2.4;
        windows.push(<rect class="intro-win" x={wx} y={y} width="3" height="4" style={{ animationDelay: `${delay.toFixed(2)}s` }} key={`w${n}`} />);
        n++;
      }
    }
  });
  return (
    <svg class="intro-skyline" viewBox="0 0 360 130" aria-hidden="true" focusable="false">
      {/* A domed civic hall among the blocks (the broadcast tower stands in front, below). */}
      <path class="intro-tower" pathLength={1} d="M154 118V92H161V82Q161 66 171 64Q181 66 181 82V92H188V118M171 64V58" style={{ animationDelay: '0.35s' }} />
      {TOWERS.map(([x, w, h], i) => (
        <rect class="intro-tower" pathLength={1} x={x} y={118 - h} width={w} height={h} key={i} style={{ animationDelay: `${(i * 0.07).toFixed(2)}s` }} />
      ))}
      <path class="intro-tower" pathLength={1} d="M286 118V60L289 40L292 60V118M284 70H294" style={{ animationDelay: '0.5s' }} />
      {windows}
      <line class="intro-ground" x1="0" y1="118.5" x2="360" y2="118.5" />
      {/* The metro, crossing the city on its viaduct. */}
      <rect class="intro-train" x="-40" y="122" width="34" height="3" rx="1.5" />
    </svg>
  );
}

/**
 * The opening screen while the game loads: a skyline that draws itself and lights up, the
 * name rising letter by letter, and a bar that fills stage by stage. When loading ends it
 * opens up onto the city (the camera flies in, in Game.ts).
 */
export function Loading(): JSX.Element {
  const msg = ui.loading.value;
  const stage = msg === null ? STAGES.length : Math.max(0, STAGES.indexOf(msg));
  const failed = msg !== null && msg.startsWith('Could not start');
  return (
    <div class={`loading${msg === null ? ' is-done' : ''}`} aria-hidden={msg === null}>
      <div class="intro-stars" aria-hidden="true" />
      <div class="loading-inner">
        <Skyline />
        <h1 class="intro-title" aria-label={GAME_NAME}>
          {GAME_NAME.toUpperCase()
            .split('')
            .map((c, i) => (
              <span style={{ animationDelay: `${(0.6 + i * 0.07).toFixed(2)}s` }} key={i} aria-hidden="true">
                {c}
              </span>
            ))}
        </h1>
        <div class="intro-sub" lang="hi">
          {GAME_NAME_HI}
        </div>
        <div class="intro-tag">A city builder with an AI council</div>
        <div class="loading-bar" role="progressbar" aria-valuemin={0} aria-valuemax={STAGES.length} aria-valuenow={stage}>
          <span style={{ width: `${Math.max(8, (stage / STAGES.length) * 100)}%` }} />
        </div>
        <div class={`loading-msg${failed ? ' is-error' : ''}`}>{msg ?? 'Ready'}</div>
      </div>
    </div>
  );
}
