import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RedFormat,
  UnsignedByteType,
  Vector4,
  type Texture,
} from 'three';
import { VERTS, WATER_LEVEL, WORLD } from '../../core/constants';
import { clamp } from '../../core/math';
import { terrainHeight } from '../../sim/map/terrain';

/** Heights are packed into 8 bits over this range around the water level. */
const DEPTH_RANGE = 8;
const FAR_SIZE = 512;
const FAR_MIN = -6144;
const FAR_SPAN = 14336;

function packHeight(h: number): number {
  return Math.round(clamp((h - WATER_LEVEL + DEPTH_RANGE) / (2 * DEPTH_RANGE), 0, 1) * 255);
}

/**
 * One large water plane. Depth comes from the terrain height field (sampled as a texture)
 * rather than the depth buffer, which gives shoreline transparency, depth colour and foam
 * without an extra render pass.
 */
export class WaterRenderer {
  readonly mesh: Mesh;
  private readonly nearTex: DataTexture;
  private readonly farTex: DataTexture;

  constructor(heights: Float32Array, seed: number, normalMap: Texture, noise: Texture, shared: { uTime: { value: number } }) {
    this.nearTex = new DataTexture(new Uint8Array(VERTS * VERTS), VERTS, VERTS, RedFormat, UnsignedByteType);
    this.farTex = new DataTexture(new Uint8Array(FAR_SIZE * FAR_SIZE), FAR_SIZE, FAR_SIZE, RedFormat, UnsignedByteType);
    for (const t of [this.nearTex, this.farTex]) {
      t.magFilter = LinearFilter;
      t.minFilter = LinearFilter;
      t.wrapS = t.wrapT = ClampToEdgeWrapping;
      t.unpackAlignment = 1;
    }
    this.setHeights(heights, seed);

    const mat = new MeshStandardMaterial({
      color: new Color(1, 1, 1),
      roughness: 0.15,
      metalness: 0,
      transparent: true,
      envMapIntensity: 1.25,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = shared.uTime;
      shader.uniforms.uWaterNormal = { value: normalMap };
      shader.uniforms.uNoise = { value: noise };
      shader.uniforms.uDepthNear = { value: this.nearTex };
      shader.uniforms.uDepthFar = { value: this.farTex };
      // xy = offset, zw = 1/size for each depth texture in world metres.
      shader.uniforms.uNearRect = { value: new Vector4(0, 0, 1 / WORLD, 1 / WORLD) };
      shader.uniforms.uFarRect = { value: new Vector4(FAR_MIN, FAR_MIN, 1 / FAR_SPAN, 1 / FAR_SPAN) };
      shader.uniforms.uShallow = { value: new Color(0.075, 0.2, 0.17) };
      shader.uniforms.uDeep = { value: new Color(0.01, 0.042, 0.062) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          uniform float uTime;
          uniform sampler2D uWaterNormal;
          uniform sampler2D uNoise;
          uniform sampler2D uDepthNear;
          uniform sampler2D uDepthFar;
          uniform vec4 uNearRect;
          uniform vec4 uFarRect;
          uniform vec3 uShallow;
          uniform vec3 uDeep;
          varying vec3 vWPos;

          float terrainBelow(vec2 p) {
            vec2 un = (p - uNearRect.xy) * uNearRect.zw;
            vec2 uf = (p - uFarRect.xy) * uFarRect.zw;
            float hn = texture2D(uDepthNear, un * ${((VERTS - 1) / VERTS).toFixed(6)} + ${(0.5 / VERTS).toFixed(6)}).r;
            float hf = texture2D(uDepthFar, uf).r;
            vec2 e = min(un, 1.0 - un);
            float inside = smoothstep(0.0, 0.01, min(e.x, e.y));
            return (mix(hf, hn, inside) * 2.0 - 1.0) * ${DEPTH_RANGE.toFixed(1)};
          }`,
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
          vec2 wP = vWPos.xz;
          float wDepth = -terrainBelow(wP);
          float wDist = length(cameraPosition - vWPos);
          // Two normal layers drifting in different directions, plus a broad slow swell.
          vec3 wn1 = texture2D(uWaterNormal, wP / 23.0 + uTime * vec2(0.013, 0.008)).xyz * 2.0 - 1.0;
          vec3 wn2 = texture2D(uWaterNormal, wP / 9.0 + uTime * vec2(-0.017, 0.012)).xyz * 2.0 - 1.0;
          vec3 wn3 = texture2D(uWaterNormal, wP / 97.0 + uTime * vec2(0.004, -0.003)).xyz * 2.0 - 1.0;
          float wCalm = 1.0 / (1.0 + wDist * 0.0012);
          // Fade the fine ripples with distance so they do not turn into a repeating pattern.
          float wBreak = texture2D(uNoise, wP / 410.0 + uTime * 0.002).g;
          vec2 wSlope = (wn1.xy * 0.42 * (0.4 + 0.6 * wCalm) + wn2.xy * 0.34 * wCalm + wn3.xy * 0.4) * (0.14 + 0.2 * wBreak);

          float wT = 1.0 - exp(-max(wDepth, 0.0) * 0.55);
          vec3 wCol = mix(uShallow, uDeep, wT);
          // Foam: a broken line where the water meets the bank.
          float wFoamNoise = texture2D(uNoise, wP / 17.0 + uTime * vec2(0.01, 0.006)).r;
          float wFoam = smoothstep(0.42, 0.0, wDepth) * smoothstep(0.35, 0.62, wFoamNoise + (0.35 - wDepth) * 0.5);
          wCol = mix(wCol, vec3(0.62, 0.68, 0.68), wFoam * 0.7);
          diffuseColor.rgb = wCol;
          diffuseColor.a = smoothstep(0.0, 0.5, wDepth) * mix(0.72, 1.0, wT);
          diffuseColor.a = max(diffuseColor.a, wFoam * 0.8);
          `,
        )
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.6, wFoam);')
        .replace(
          '#include <normal_fragment_maps>',
          'normal = normalize((viewMatrix * vec4(normalize(vec3(wSlope.x, 1.0, wSlope.y)), 0.0)).xyz);',
        );
    };
    mat.customProgramCacheKey = () => 'water-v2';

    const geo = new PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new Mesh(geo, mat);
    this.mesh.scale.set(FAR_SPAN * 2, 1, FAR_SPAN * 2);
    this.mesh.position.set(WORLD / 2, WATER_LEVEL, WORLD / 2);
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
    this.mesh.updateMatrix();
    this.mesh.matrixAutoUpdate = false;
  }

  setHeights(heights: Float32Array, seed: number): void {
    const near = this.nearTex.image.data as Uint8Array;
    for (let i = 0; i < near.length; i++) near[i] = packHeight(heights[i]!);
    this.nearTex.needsUpdate = true;
    const far = this.farTex.image.data as Uint8Array;
    for (let j = 0; j < FAR_SIZE; j++) {
      for (let i = 0; i < FAR_SIZE; i++) {
        const x = FAR_MIN + ((i + 0.5) / FAR_SIZE) * FAR_SPAN;
        const z = FAR_MIN + ((j + 0.5) / FAR_SIZE) * FAR_SPAN;
        far[j * FAR_SIZE + i] = packHeight(terrainHeight(x, z, seed));
      }
    }
    this.farTex.needsUpdate = true;
  }

  /** Refreshes the near depth texture after terraforming. */
  updateHeights(heights: Float32Array): void {
    const near = this.nearTex.image.data as Uint8Array;
    for (let i = 0; i < near.length; i++) near[i] = packHeight(heights[i]!);
    this.nearTex.needsUpdate = true;
  }
}
