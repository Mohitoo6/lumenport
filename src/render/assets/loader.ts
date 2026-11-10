import {
  DataArrayTexture,
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
} from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { proceduralPixels } from './procedural';

const BASE = `${import.meta.env.BASE_URL}assets/`;

export type MapKind = 'diff' | 'nor' | 'arm';

/** Rough average colour per texture role, used only when the real file is missing. */
const FALLBACK_COLOR: Record<string, [number, number, number]> = {
  grass: [92, 118, 52],
  grass2: [104, 112, 66],
  dirt: [112, 90, 66],
  rock: [128, 124, 116],
  sand: [196, 178, 140],
  asphalt: [62, 62, 64],
  concrete: [150, 148, 142],
  brick: [142, 82, 62],
  brick2: [150, 70, 54],
  plaster: [208, 200, 184],
  plaster2: [214, 204, 180],
  concrete_wall: [156, 154, 150],
  metal: [140, 146, 150],
  roof: [110, 66, 52],
  roof2: [168, 92, 62],
  roof3: [96, 98, 104],
  bark: [92, 72, 54],
};

export const loadWarnings: string[] = [];

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

async function loadPixels(role: string, kind: MapKind, size: number): Promise<Uint8ClampedArray> {
  try {
    const img = await loadImage(`${BASE}textures/${role}_${kind}.jpg`);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, size, size);
    return ctx.getImageData(0, 0, size, size).data;
  } catch {
    loadWarnings.push(`texture ${role}_${kind} missing, using procedural stand-in`);
    return proceduralPixels(kind, FALLBACK_COLOR[role] ?? [128, 128, 128], size, role.length * 131 + kind.length);
  }
}

/**
 * Packs one map kind from several texture sets into a 2D array texture, one layer per
 * role. The terrain shader blends five materials, which would not fit in the sampler
 * budget as separate textures.
 */
export async function loadTextureArray(roles: readonly string[], kind: MapKind, size = 1024, anisotropy = 8): Promise<DataArrayTexture> {
  const layers = await Promise.all(roles.map((r) => loadPixels(r, kind, size)));
  const data = new Uint8Array(size * size * 4 * roles.length);
  layers.forEach((px, i) => data.set(px, i * size * size * 4));
  const tex = new DataArrayTexture(data, size, size, roles.length);
  tex.format = RGBAFormat;
  tex.type = UnsignedByteType;
  tex.colorSpace = kind === 'diff' ? SRGBColorSpace : NoColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

export interface PbrSet {
  map: Texture;
  normalMap: Texture;
  /** R = ambient occlusion, G = roughness, B = metalness (glTF ORM layout). */
  armMap: Texture;
}

const pbrCache = new Map<string, Promise<PbrSet>>();

async function loadMap(role: string, kind: MapKind, anisotropy: number): Promise<Texture> {
  let tex: Texture;
  try {
    const img = await loadImage(`${BASE}textures/${role}_${kind}.jpg`);
    tex = new Texture(img);
  } catch {
    loadWarnings.push(`texture ${role}_${kind} missing, using procedural stand-in`);
    const size = 256;
    const px = proceduralPixels(kind, FALLBACK_COLOR[role] ?? [128, 128, 128], size, role.length * 131 + kind.length);
    tex = new DataTexture(new Uint8Array(px.buffer), size, size, RGBAFormat, UnsignedByteType);
    tex.magFilter = LinearFilter;
  }
  tex.colorSpace = kind === 'diff' ? SRGBColorSpace : NoColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

/** Loads a diffuse / normal / ARM set as ordinary 2D textures for standard materials. */
export function loadPbr(role: string, anisotropy = 8): Promise<PbrSet> {
  let p = pbrCache.get(role);
  if (!p) {
    p = Promise.all([loadMap(role, 'diff', anisotropy), loadMap(role, 'nor', anisotropy), loadMap(role, 'arm', anisotropy)]).then(
      ([map, normalMap, armMap]) => ({ map, normalMap, armMap }),
    );
    pbrCache.set(role, p);
  }
  return p;
}

export type HdriRole = 'day' | 'golden' | 'night';

/** Simple vertical-gradient skies, used only if an HDRI file is missing. */
const FALLBACK_SKY: Record<HdriRole, { zenith: [number, number, number]; horizon: [number, number, number]; sun: number }> = {
  day: { zenith: [0.25, 0.45, 0.95], horizon: [0.85, 0.92, 1.05], sun: 60 },
  golden: { zenith: [0.22, 0.3, 0.55], horizon: [1.1, 0.62, 0.32], sun: 30 },
  night: { zenith: [0.004, 0.006, 0.014], horizon: [0.012, 0.014, 0.022], sun: 0 },
};

function fallbackSky(role: HdriRole): DataTexture {
  const w = 512;
  const h = 256;
  const cfg = FALLBACK_SKY[role];
  const data = new Float32Array(w * h * 4);
  // Row 0 is the top of the image (zenith), matching HDR file layout; flipY handles upload.
  for (let y = 0; y < h; y++) {
    const elev = 1 - (y + 0.5) / h; // 1 zenith .. 0 nadir
    const t = Math.max(0, Math.min(1, (elev - 0.5) * 2));
    const k = Math.pow(t, 0.45);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = cfg.horizon[c]! + (cfg.zenith[c]! - cfg.horizon[c]!) * k;
      // A soft sun about 45 degrees up.
      const du = (x / w - 0.3) * 2;
      const dv = (elev - 0.75) * 2;
      const d2 = du * du + dv * dv;
      const s = cfg.sun * Math.exp(-d2 * 900);
      data[i] += s;
      data[i + 1] += s * 0.95;
      data[i + 2] += s * 0.85;
      data[i + 3] = 1;
    }
  }
  const tex = new DataTexture(data, w, h, RGBAFormat, FloatType);
  tex.flipY = true;
  return tex;
}

/** Loads an equirectangular HDR sky. Linear colour, half-float data. */
export async function loadHdri(role: HdriRole): Promise<DataTexture> {
  let tex: DataTexture;
  try {
    tex = await new HDRLoader().loadAsync(`${BASE}hdri/${role}.hdr`);
  } catch {
    loadWarnings.push(`hdri ${role} missing, using procedural sky`);
    tex = fallbackSky(role);
  }
  tex.mapping = EquirectangularReflectionMapping;
  tex.colorSpace = LinearSRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}
