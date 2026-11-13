import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  Mesh,
  RingGeometry,
  ShaderMaterial,
  Vector4,
} from 'three';
import { WATER_LEVEL } from '../../core/constants';
import { heightAt } from '../../sim/map/terrain';
import { bezPoint, bezTangent, type Pt } from '../../sim/roads/geometry';
import type { TerrainFx } from '../terrain/terrainMaterial';

const MAX_STATIONS = 160;
const p: Pt = { x: 0, z: 0 };
const t: Pt = { x: 0, z: 0 };

export type PreviewTone = 'ok' | 'bad' | 'neutral' | 'remove';

const TONES: Record<PreviewTone, Color> = {
  ok: new Color(0.35, 0.8, 1.0),
  bad: new Color(1.0, 0.25, 0.2),
  neutral: new Color(0.95, 0.95, 0.95),
  remove: new Color(1.0, 0.35, 0.15),
};

/**
 * Tool feedback drawn in the world: a translucent ribbon showing where a road would go
 * (or which one would be removed), a ring at the snapped cursor position, and the build
 * grid on the terrain around it.
 */
export class ToolPreview {
  readonly group = new Group();
  /** Uniforms shared with the terrain material: build grid, zone tint, selection rectangle. */
  readonly fx: TerrainFx = {
    grid: { value: new Vector4(0, 0, 150, 0) },
    zoneTex: { value: null },
    zoneAlpha: { value: 0.16 },
    sel: { value: new Vector4() },
    selColor: { value: new Vector4(0, 0, 0, 0) },
    overlayTex: { value: null },
    overlayAlpha: { value: 0 },
  };
  readonly grid = this.fx.grid;
  /** Set by the game: lets the zone tool show land before it is zoned. */
  zoneOverlay: import('../overlays/zoneOverlay').ZoneOverlay | null = null;
  /** Set by the game: shows a metro line being drawn (null hides it). */
  metroPreview: ((pts: readonly number[] | null, ok: boolean) => void) | null = null;
  private zoneTarget = 0.16;
  private readonly ribbon: Mesh;
  private readonly ribbonMat: ShaderMaterial;
  private readonly ring: Mesh;
  private readonly ringMat: ShaderMaterial;
  private gridTarget = 0;

  constructor(private readonly getHeights: () => Float32Array) {
    const geo = new BufferGeometry();
    const pos = new BufferAttribute(new Float32Array(MAX_STATIONS * 2 * 3), 3);
    pos.setUsage(DynamicDrawUsage);
    const uv = new BufferAttribute(new Float32Array(MAX_STATIONS * 2 * 2), 2);
    uv.setUsage(DynamicDrawUsage);
    geo.setAttribute('position', pos);
    geo.setAttribute('uv', uv);
    const idx: number[] = [];
    for (let i = 0; i < MAX_STATIONS - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);

    this.ribbonMat = new ShaderMaterial({
      uniforms: { uColor: { value: new Color() }, uWidth: { value: 16 }, uRoadway: { value: 10 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uWidth;
        uniform float uRoadway;
        varying vec2 vUv;
        void main() {
          float u = abs(vUv.x) * uWidth * 0.5;
          float aa = fwidth(u) + 1e-4;
          float edge = 1.0 - smoothstep(0.0, aa * 1.5 + 0.35, uWidth * 0.5 - u);
          float curb = 1.0 - smoothstep(0.0, aa + 0.12, abs(u - uRoadway * 0.5));
          float centre = (1.0 - smoothstep(0.0, aa + 0.1, u)) * step(0.5, fract(vUv.y / 6.0));
          float a = 0.26 + edge * 0.6 + curb * 0.3 + centre * 0.45;
          gl_FragColor = vec4(uColor * (1.1 + edge * 0.8), min(a, 0.95));
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    });
    this.ribbon = new Mesh(geo, this.ribbonMat);
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = 900;
    this.ribbon.visible = false;
    this.group.add(this.ribbon);

    const ringGeo = new RingGeometry(0.72, 1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = new ShaderMaterial({
      uniforms: { uColor: { value: new Color() } },
      vertexShader: /* glsl */ `
        void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        void main() { gl_FragColor = vec4(uColor * 1.4, 0.9); }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    });
    this.ring = new Mesh(ringGeo, this.ringMat);
    this.ring.renderOrder = 901;
    this.ring.visible = false;
    this.group.add(this.ring);
  }

  private ground(x: number, z: number): number {
    return Math.max(WATER_LEVEL, heightAt(this.getHeights(), x, z)) + 0.45;
  }

  /** Shows a ribbon along a quadratic Bezier (straight roads pass the midpoint as control). */
  showRoad(ax: number, az: number, cx: number, cz: number, bx: number, bz: number, width: number, roadway: number, tone: PreviewTone): void {
    const geo = this.ribbon.geometry;
    const pos = geo.getAttribute('position') as BufferAttribute;
    const uv = geo.getAttribute('uv') as BufferAttribute;
    const chord = Math.hypot(bx - ax, bz - az) + Math.hypot(cx - (ax + bx) / 2, cz - (az + bz) / 2);
    const n = Math.max(2, Math.min(MAX_STATIONS, Math.ceil(chord / 5) + 1));
    const hw = width / 2;
    let arc = 0;
    let px = ax;
    let pz = az;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      bezPoint(ax, az, cx, cz, bx, bz, k, p);
      bezTangent(ax, az, cx, cz, bx, bz, k, t);
      const len = Math.hypot(t.x, t.z) || 1;
      const rx = -t.z / len;
      const rz = t.x / len;
      arc += Math.hypot(p.x - px, p.z - pz);
      px = p.x;
      pz = p.z;
      const y = this.ground(p.x, p.z);
      pos.setXYZ(i * 2, p.x - rx * hw, y, p.z - rz * hw);
      pos.setXYZ(i * 2 + 1, p.x + rx * hw, y, p.z + rz * hw);
      uv.setXY(i * 2, -1, arc);
      uv.setXY(i * 2 + 1, 1, arc);
    }
    pos.needsUpdate = true;
    uv.needsUpdate = true;
    geo.setDrawRange(0, (n - 1) * 6);
    (this.ribbonMat.uniforms.uColor!.value as Color).copy(TONES[tone]);
    this.ribbonMat.uniforms.uWidth!.value = width;
    this.ribbonMat.uniforms.uRoadway!.value = roadway;
    this.ribbon.visible = true;
  }

  hideRoad(): void {
    this.ribbon.visible = false;
  }

  showCursor(x: number, z: number, radius: number, tone: PreviewTone): void {
    this.ring.position.set(x, this.ground(x, z) + 0.05, z);
    this.ring.scale.setScalar(radius);
    (this.ringMat.uniforms.uColor!.value as Color).copy(TONES[tone]);
    this.ring.visible = true;
    this.grid.value.x = x;
    this.grid.value.y = z;
  }

  hideCursor(): void {
    this.ring.visible = false;
  }

  /** Highlights a rectangle of ground (world metres). */
  showRect(x0: number, z0: number, x1: number, z1: number, tone: PreviewTone, alpha = 0.5): void {
    this.fx.sel.value.set(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1));
    const c = TONES[tone];
    this.fx.selColor.value.set(c.r, c.g, c.b, alpha);
  }

  /** Highlights a rectangle in an explicit linear colour. */
  showRectColor(x0: number, z0: number, x1: number, z1: number, r: number, g: number, b: number, alpha = 0.6): void {
    this.fx.sel.value.set(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1));
    this.fx.selColor.value.set(r, g, b, alpha);
  }

  hideRect(): void {
    this.fx.selColor.value.w = 0;
  }

  /** Zone colours are faint normally and strong while zoning. */
  setZoneView(strong: boolean): void {
    this.zoneTarget = strong ? 0.72 : 0.16;
  }

  /** Turns the terrain build grid on or off; it fades rather than popping. */
  setGrid(on: boolean): void {
    this.gridTarget = on ? 1 : 0;
  }

  update(dt: number, viewDistance: number): void {
    const g = this.grid.value;
    g.w += (this.gridTarget - g.w) * (1 - Math.exp(-10 * dt));
    if (g.w < 0.002) g.w = 0;
    // Hide the grid when zoomed far out, where it would turn to moire.
    g.z = Math.min(170, Math.max(70, viewDistance * 0.4));
    if (viewDistance > 900) g.w = 0;
    const za = this.fx.zoneAlpha;
    za.value += (this.zoneTarget - za.value) * (1 - Math.exp(-10 * dt));
  }
}
