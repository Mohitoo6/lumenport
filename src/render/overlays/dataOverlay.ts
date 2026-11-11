import { ClampToEdgeWrapping, DataTexture, LinearFilter, RGBAFormat, UnsignedByteType } from 'three';
import { MAP, VERTS } from '../../core/constants';
import { Service } from '../../sim/facilities';
import type { Sim } from '../../sim/sim';
import { POWERED, WATERED } from '../../sim/utilities/network';

export type OverlayId = 'none' | 'power' | 'water' | 'traffic' | 'pollution' | 'crime' | 'landValue' | 'happiness' | 'police' | 'fire' | 'health' | 'education';

export interface OverlayInfo {
  id: OverlayId;
  name: string;
  /** Legend: label for the low end, the high end, and the CSS gradient between them. */
  low: string;
  high: string;
  gradient: string;
}

type RGB = readonly [number, number, number];

const YELLOW: RGB = [250, 214, 70];
const ORANGE: RGB = [242, 128, 36];
const RED: RGB = [214, 44, 40];
const GREEN: RGB = [70, 190, 96];
const TEAL: RGB = [44, 150, 210];
const MINT: RGB = [130, 236, 170];
const BLUE: RGB = [70, 140, 255];
const GREY: RGB = [120, 124, 130];

const css = (c: RGB): string => `rgb(${c[0]},${c[1]},${c[2]})`;
const BAD = `linear-gradient(90deg, ${css(YELLOW)}, ${css(ORANGE)}, ${css(RED)})`;
const GOOD = `linear-gradient(90deg, ${css(TEAL)}, ${css(MINT)})`;
const DIVERGING = `linear-gradient(90deg, ${css(RED)}, ${css(YELLOW)}, ${css(GREEN)})`;

export const OVERLAYS: OverlayInfo[] = [
  { id: 'none', name: 'Normal view', low: '', high: '', gradient: '' },
  { id: 'power', name: 'Power', low: 'Unserved', high: 'Served', gradient: `linear-gradient(90deg, ${css(RED)} 50%, ${css(GREEN)} 50%)` },
  { id: 'water', name: 'Water', low: 'Unserved', high: 'Served', gradient: `linear-gradient(90deg, ${css(RED)} 50%, ${css(GREEN)} 50%)` },
  { id: 'traffic', name: 'Traffic', low: 'Free', high: 'Jammed', gradient: `linear-gradient(90deg, ${css(GREEN)}, ${css(YELLOW)}, ${css(RED)})` },
  { id: 'pollution', name: 'Pollution', low: 'Light', high: 'Heavy', gradient: BAD },
  { id: 'crime', name: 'Crime', low: 'Low', high: 'High', gradient: BAD },
  { id: 'landValue', name: 'Land value', low: 'Low', high: 'High', gradient: DIVERGING },
  { id: 'happiness', name: 'Happiness', low: 'Unhappy', high: 'Happy', gradient: DIVERGING },
  { id: 'police', name: 'Police cover', low: 'Edge', high: 'Close', gradient: GOOD },
  { id: 'fire', name: 'Fire cover', low: 'Edge', high: 'Close', gradient: GOOD },
  { id: 'health', name: 'Health cover', low: 'Edge', high: 'Close', gradient: GOOD },
  { id: 'education', name: 'Education cover', low: 'Edge', high: 'Close', gradient: GOOD },
];

const COVERAGE: Partial<Record<OverlayId, Service>> = {
  police: Service.Police,
  fire: Service.Fire,
  health: Service.Health,
  education: Service.Education,
};

function lerp3(a: RGB, b: RGB, t: number, out: Uint8Array, o: number): void {
  out[o] = a[0] + (b[0] - a[0]) * t;
  out[o + 1] = a[1] + (b[1] - a[1]) * t;
  out[o + 2] = a[2] + (b[2] - a[2]) * t;
}

/** Three-stop ramp. */
function ramp(a: RGB, b: RGB, c: RGB, v: number, out: Uint8Array, o: number): void {
  if (v < 0.5) lerp3(a, b, v * 2, out, o);
  else lerp3(b, c, v * 2 - 1, out, o);
}

/**
 * Data views. One layer at a time is painted into a texture with one texel per cell; the
 * terrain, road and building shaders desaturate the world and lay the colours over it.
 */
export class DataOverlay {
  readonly texture: DataTexture;
  /** Shared with the shaders: 0 is the normal view, 1 is full overlay. */
  readonly alpha = { value: 0 };
  id: OverlayId = 'none';
  private readonly data = new Uint8Array(MAP * MAP * 4);

  constructor() {
    this.texture = new DataTexture(this.data, MAP, MAP, RGBAFormat, UnsignedByteType);
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearFilter;
    this.texture.wrapS = this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }

  set(id: OverlayId, sim: Sim): void {
    this.id = id;
    if (id !== 'none') this.refresh(sim);
  }

  update(dt: number): void {
    const target = this.id === 'none' ? 0 : 1;
    this.alpha.value += (target - this.alpha.value) * (1 - Math.exp(-9 * dt));
    if (this.alpha.value < 0.003) this.alpha.value = 0;
  }

  /** Repaints the texture from the simulation's current data. */
  refresh(sim: Sim): void {
    const id = this.id;
    if (id === 'none') return;
    const d = this.data;
    const s = sim.state;
    const f = sim.fields;
    d.fill(0);

    if (id === 'power' || id === 'water') {
      const bit = id === 'power' ? POWERED : WATERED;
      const supply = id === 'power' ? sim.net.powerSupply : sim.net.waterSupply;
      for (let k = 0; k < MAP * MAP; k++) {
        const o = k * 4;
        const c = sim.net.comp[k]!;
        if (s.roadCell[k]! >= 0) {
          const live = c >= 0 && (supply[c] ?? 0) > 0;
          lerp3(live ? BLUE : GREY, BLUE, 0, d, o);
          d[o + 3] = live ? 235 : 150;
          continue;
        }
        const b = s.buildingCell[k]! >= 0 ? s.buildings[s.buildingCell[k]!] : null;
        if (!b) continue;
        const ok = b.kind !== 0 || (b.flags & bit) !== 0;
        lerp3(b.kind !== 0 ? BLUE : ok ? GREEN : RED, RED, 0, d, o);
        d[o + 3] = 225;
      }
    } else if (id === 'traffic') {
      const dens = sim.traffic.density;
      for (let k = 0; k < MAP * MAP; k++) {
        const e = s.roadCell[k]!;
        if (e < 0) continue;
        // About 12 cars per 100 m of road is a standing queue in both directions.
        const v = Math.min(1, (dens[e] ?? 0) / 10);
        ramp(GREEN, YELLOW, RED, v, d, k * 4);
        d[k * 4 + 3] = 240;
      }
    } else if (id === 'pollution' || id === 'crime') {
      const a = id === 'pollution' ? f.pollution : f.crime;
      const gain = id === 'crime' ? 2.2 : 1;
      for (let k = 0; k < MAP * MAP; k++) {
        const v = Math.min(1, a[k]! * gain);
        if (v < 0.015) continue;
        ramp(YELLOW, ORANGE, RED, v, d, k * 4);
        d[k * 4 + 3] = Math.min(225, 70 + v * 400);
      }
    } else if (id === 'landValue') {
      for (let j = 0; j < MAP; j++) {
        for (let i = 0; i < MAP; i++) {
          if (s.heights[j * VERTS + i]! < 0.2) continue;
          const k = j * MAP + i;
          // Stretch the useful range (roughly 0.1 to 0.9) across the ramp.
          ramp(RED, YELLOW, GREEN, Math.min(1, Math.max(0, (f.landValue[k]! - 0.1) / 0.75)), d, k * 4);
          d[k * 4 + 3] = 190;
        }
      }
    } else if (id === 'happiness') {
      for (let k = 0; k < MAP * MAP; k++) {
        const v = f.happiness[k]!;
        if (v <= 0) continue;
        ramp(RED, YELLOW, GREEN, Math.min(1, Math.max(0, (v - 0.15) / 0.7)), d, k * 4);
        d[k * 4 + 3] = 235;
      }
    } else {
      const a = f.coverage[COVERAGE[id]!]!;
      for (let k = 0; k < MAP * MAP; k++) {
        const v = a[k]!;
        if (v <= 0) continue;
        lerp3(TEAL, MINT, v, d, k * 4);
        d[k * 4 + 3] = 70 + v * 150;
      }
    }
    this.texture.needsUpdate = true;
  }
}
