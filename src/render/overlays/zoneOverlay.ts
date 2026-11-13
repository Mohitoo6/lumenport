import { DataTexture, NearestFilter, RGBAFormat, UnsignedByteType } from 'three';
import { MAP } from '../../core/constants';
import type { CellRect } from '../../sim/sim';
import { ZoneType, zoneDensity, zoneType } from '../../sim/zoning/zones';

/** Zone colours as linear RGB (0-255), indexed [type][density]. Shared with the HUD. */
export const ZONE_RGB: Record<number, [number, number, number][]> = {
  [ZoneType.Residential]: [[0, 0, 0], [58, 176, 62], [34, 138, 44], [16, 98, 30]],
  [ZoneType.Commercial]: [[0, 0, 0], [62, 128, 240], [38, 92, 208], [20, 58, 160]],
  [ZoneType.Industrial]: [[0, 0, 0], [240, 178, 40], [220, 136, 24], [184, 96, 14]],
};

/**
 * A 256 x 256 texture with one texel per cell holding its zone colour. The terrain shader
 * tints zoned ground with it, so empty zoned land is visible until something is built.
 */
export class ZoneOverlay {
  readonly texture: DataTexture;
  private readonly data = new Uint8Array(MAP * MAP * 4);

  constructor(private zone: Uint8Array) {
    this.texture = new DataTexture(this.data, MAP, MAP, RGBAFormat, UnsignedByteType);
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    this.update({ x0: 0, y0: 0, x1: MAP - 1, y1: MAP - 1 });
  }

  private shown: number[] = [];

  /**
   * Tints `cells` as they would look once zoned (brighter than real zoning), or red where
   * zoning would be cleared. Replaces any previous preview.
   */
  preview(cells: readonly number[], zone: number): void {
    this.clearPreview();
    const c = zone === 0 ? [235, 70, 60] : ZONE_RGB[zoneType(zone)]![zoneDensity(zone)]!;
    const lift = zone === 0 ? 0 : 0.45;
    for (const k of cells) {
      const o = k * 4;
      this.data[o] = c[0] + (255 - c[0]) * lift;
      this.data[o + 1] = c[1] + (255 - c[1]) * lift;
      this.data[o + 2] = c[2] + (255 - c[2]) * lift;
      this.data[o + 3] = 255;
    }
    this.shown = cells.slice();
    this.texture.needsUpdate = true;
  }

  clearPreview(): void {
    if (this.shown.length === 0) return;
    let x0 = MAP;
    let y0 = MAP;
    let x1 = 0;
    let y1 = 0;
    for (const k of this.shown) {
      const i = k % MAP;
      const j = (k / MAP) | 0;
      x0 = Math.min(x0, i);
      x1 = Math.max(x1, i);
      y0 = Math.min(y0, j);
      y1 = Math.max(y1, j);
    }
    this.shown = [];
    this.update({ x0, y0, x1, y1 });
  }

  setSource(zone: Uint8Array): void {
    this.zone = zone;
    this.update({ x0: 0, y0: 0, x1: MAP - 1, y1: MAP - 1 });
  }

  update(r: CellRect): void {
    const x0 = Math.max(0, r.x0);
    const y0 = Math.max(0, r.y0);
    const x1 = Math.min(MAP - 1, r.x1);
    const y1 = Math.min(MAP - 1, r.y1);
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const k = j * MAP + i;
        const z = this.zone[k]!;
        const o = k * 4;
        if (z === 0) {
          this.data[o + 3] = 0;
          continue;
        }
        const c = ZONE_RGB[zoneType(z)]![zoneDensity(z)]!;
        this.data[o] = c[0];
        this.data[o + 1] = c[1];
        this.data[o + 2] = c[2];
        this.data[o + 3] = 255;
      }
    }
    this.texture.needsUpdate = true;
  }
}
