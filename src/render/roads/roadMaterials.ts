import { Color, MeshStandardMaterial, type Texture } from 'three';
import type { PbrSet } from '../assets/loader';
import type { TerrainFx } from '../terrain/terrainMaterial';

function pbr(set: PbrSet, tint: Color, extra: Partial<ConstructorParameters<typeof MeshStandardMaterial>[0]> = {}): MeshStandardMaterial {
  return new MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    aoMap: set.armMap,
    roughnessMap: set.armMap,
    metalnessMap: set.armMap,
    color: tint,
    roughness: 1,
    metalness: 1,
    ...extra,
  });
}

const LANE_PARS = /* glsl */ `
  uniform sampler2D uNoise;
  uniform sampler2D uOverlayTex;
  uniform float uOverlayAlpha;
  varying vec4 vLane;
  varying float vLaneKind;

  // Antialiased line of half-width hw centred on c.
  float lnLine(float x, float c, float hw) {
    float w = fwidth(x) * 0.8 + 1e-4;
    return 1.0 - smoothstep(hw - w, hw + w, abs(x - c));
  }
  // 1 between a and b.
  float lnBand(float x, float a, float b) {
    float w = fwidth(x) * 0.8 + 1e-4;
    return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x));
  }
  float lnDash(float v, float on, float period) {
    float f = mod(v, period);
    float w = fwidth(v) * 0.8 + 1e-4;
    return smoothstep(0.0, w, f) * (1.0 - smoothstep(on - w, on + w, f));
  }
`;

const LANE_MAIN = /* glsl */ `
  float lnWhite = 0.0;
  float lnYellow = 0.0;
  {
    float u = vLane.x;
    float v = vLane.y;
    float dA = vLane.z;
    float dB = vLane.w;
    float au = abs(u);
    if (vLaneKind < 1.5) {
      bool street = vLaneKind < 0.5;
      float rw = street ? 5.0 : 11.5;
      float laneMin = street ? 0.12 : 1.95;
      float laneMax = street ? 3.3 : 8.9;
      // Lane lines stop at the stop line.
      float open = smoothstep(4.7, 4.9, min(dA, dB));
      if (street) {
        lnYellow += lnLine(u, 0.0, 0.065) * lnDash(v, 3.0, 9.0) * open;
        lnWhite += lnLine(au, laneMax, 0.05) * open * 0.7;
      } else {
        lnYellow += lnLine(au, laneMin, 0.07) * open;
        lnWhite += lnLine(au, 5.4, 0.06) * lnDash(v, 3.0, 9.0) * open;
        lnWhite += lnLine(au, laneMax, 0.05) * open * 0.7;
      }
      // Zebra crossing just before each junction mouth.
      float zone = max(lnBand(dA, 0.8, 3.6), lnBand(dB, 0.8, 3.6));
      float tri = abs(fract(u / 1.1) - 0.5);
      float bw = fwidth(u / 1.1) * 0.8 + 1e-4;
      float bars = 1.0 - smoothstep(0.25 - bw, 0.25 + bw, tri);
      lnWhite += zone * bars * (1.0 - smoothstep(rw - 0.45, rw - 0.35, au));
      // Stop lines across the lanes that arrive at each mouth (traffic keeps right).
      lnWhite += lnBand(dB, 4.25, 4.7) * lnBand(u, laneMin, laneMax);
      lnWhite += lnBand(dA, 4.25, 4.7) * lnBand(-u, laneMin, laneMax);
    }
  }
  // Broad tonal drift and patchiness so long roads are not one flat grey.
  vec4 lnNoise = texture2D(uNoise, vMapUv * 0.083);
  diffuseColor.rgb *= 0.86 + 0.26 * lnNoise.g;
  float lnWear = 0.5 + 0.5 * smoothstep(0.2, 0.75, texture2D(uNoise, vMapUv * 0.9).r);
  float lnPaint = clamp(lnWhite + lnYellow, 0.0, 1.0) * lnWear;
  vec3 lnColor = mix(vec3(0.62, 0.62, 0.6), vec3(0.66, 0.44, 0.05), lnYellow / (lnWhite + lnYellow + 1e-4));
  diffuseColor.rgb = mix(diffuseColor.rgb, lnColor, lnPaint * 0.9);
  // Data view: the road takes its cell's colour (asphalt UVs are world metres / 5).
  if (uOverlayAlpha > 0.0) {
    vec4 lnOv = texture2D(uOverlayTex, vMapUv * 5.0 / 2048.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, lnOv.rgb * 0.9, lnOv.a * uOverlayAlpha * 0.85);
  }
`;

export interface RoadMaterials {
  asphalt: MeshStandardMaterial;
  pavement: MeshStandardMaterial;
  concrete: MeshStandardMaterial;
  grass: MeshStandardMaterial;
}

/**
 * Road surface materials. Lane markings, crosswalks and stop lines are drawn by the
 * asphalt shader from per-vertex road coordinates (metres across, metres along, metres to
 * each junction), so they are sharp at any zoom and can never z-fight with the road.
 */
export function createRoadMaterials(sets: { asphalt: PbrSet; pavement: PbrSet; concrete: PbrSet; grass: PbrSet }, noise: Texture, fx: TerrainFx): RoadMaterials {
  const asphalt = pbr(sets.asphalt, new Color(0.62, 0.63, 0.66));
  asphalt.onBeforeCompile = (shader) => {
    shader.uniforms.uNoise = { value: noise };
    shader.uniforms.uOverlayTex = fx.overlayTex;
    shader.uniforms.uOverlayAlpha = fx.overlayAlpha;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aLane;\nattribute float aLaneKind;\nvarying vec4 vLane;\nvarying float vLaneKind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLane = aLane;\nvLaneKind = aLaneKind;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${LANE_PARS}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${LANE_MAIN}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.5, lnPaint);');
  };
  asphalt.customProgramCacheKey = () => 'road-asphalt-v2';

  // The scans are warm and dark; tint them to the pale grey of city paving and curbstone.
  const pavement = pbr(sets.pavement, new Color(1.12, 1.2, 1.32));
  const concrete = pbr(sets.concrete, new Color(1.75, 1.75, 1.72), { roughness: 0.88 });
  concrete.roughnessMap = null;
  const grass = pbr(sets.grass, new Color(0.72, 0.95, 0.56), { metalness: 0 });
  grass.metalnessMap = null;
  return { asphalt, pavement, concrete, grass };
}
