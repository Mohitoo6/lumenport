import { MeshStandardMaterial, type DataArrayTexture, type Texture } from 'three';

/** Layer order inside the terrain texture arrays. */
export const TERRAIN_LAYERS = ['grass', 'grass2', 'dirt', 'rock', 'sand'] as const;

export interface TerrainTextures {
  diff: DataArrayTexture;
  nor: DataArrayTexture;
  arm: DataArrayTexture;
  noise: Texture;
}

const PARS = /* glsl */ `
  precision highp sampler2DArray;
  uniform sampler2DArray uTerrDiff;
  uniform sampler2DArray uTerrNor;
  uniform sampler2DArray uTerrArm;
  uniform sampler2D uNoise;
  varying vec3 vWPos;
  varying vec3 vWNormal;

  void terrLayer(float layer, float w, vec2 uvN, vec2 uvF, vec2 dNx, vec2 dNy, vec2 dFx, vec2 dFy, float farMix,
                 inout vec3 alb, inout vec3 nrm, inout float rough, inout float ao) {
    if (w < 0.004) return;
    vec3 a = textureGrad(uTerrDiff, vec3(uvN, layer), dNx, dNy).rgb;
    vec3 b = textureGrad(uTerrDiff, vec3(uvF, layer), dFx, dFy).rgb;
    alb += w * mix(a, b, farMix);
    nrm += w * (textureGrad(uTerrNor, vec3(uvN, layer), dNx, dNy).xyz * 2.0 - 1.0);
    vec3 arm = textureGrad(uTerrArm, vec3(uvN, layer), dNx, dNy).rgb;
    ao += w * arm.r;
    rough += w * arm.g;
  }
`;

const MAP = /* glsl */ `
  vec3 tWN = normalize(vWNormal);
  vec2 tP = vWPos.xz;
  float tDist = length(cameraPosition - vWPos);
  float tFar = smoothstep(45.0, 360.0, tDist);
  vec4 tNoiseA = texture(uNoise, tP / 330.0);
  vec4 tNoiseB = texture(uNoise, tP / 61.0 + 0.37);
  vec4 tNoiseC = texture(uNoise, tP / 1450.0 + 0.11);
  float tSlope = 1.0 - tWN.y;
  float tH = vWPos.y;

  // Material masks. Each later layer covers the ones before it.
  float wSand = smoothstep(1.55, 0.6, tH + (tNoiseB.g - 0.5) * 0.9);
  float wRock = smoothstep(0.12, 0.26, tSlope + (tNoiseB.r - 0.5) * 0.07);
  float wDirt = clamp(smoothstep(0.7, 0.84, tNoiseA.r * 0.65 + tNoiseB.a * 0.35) * 0.55
                    + smoothstep(0.07, 0.14, tSlope) * 0.5, 0.0, 1.0);
  // Rough grass takes over on slopes and in broad patches across the plains.
  float wG2 = clamp(smoothstep(0.4, 0.66, tNoiseC.b * 0.55 + tNoiseA.g * 0.45) * 0.85
                  + smoothstep(0.02, 0.08, tSlope), 0.0, 1.0);

  float tKeep = 1.0;
  float w4 = wSand;          tKeep *= 1.0 - wSand;
  float w3 = wRock * tKeep;  tKeep *= 1.0 - wRock;
  float w2 = wDirt * tKeep;  tKeep *= 1.0 - wDirt;
  float w1 = wG2 * tKeep;
  float w0 = tKeep - w1;

  // Two texture scales: fine up close, coarse far away, so tiling never reads as a grid.
  vec2 uvN = tP / 5.5;
  vec2 uvF = tP / 47.0;
  vec2 dNx = dFdx(uvN);
  vec2 dNy = dFdy(uvN);
  vec2 dFx = dFdx(uvF);
  vec2 dFy = dFdy(uvF);
  vec3 tAlb = vec3(0.0);
  vec3 tNrm = vec3(0.0);
  float tRough = 0.0;
  float tAo = 0.0;
  terrLayer(0.0, w0, uvN, uvF, dNx, dNy, dFx, dFy, tFar, tAlb, tNrm, tRough, tAo);
  terrLayer(1.0, w1, uvN * 0.31, uvF * 0.53, dNx * 0.31, dNy * 0.31, dFx * 0.53, dFy * 0.53, tFar, tAlb, tNrm, tRough, tAo);
  terrLayer(2.0, w2, uvN, uvF, dNx, dNy, dFx, dFy, tFar, tAlb, tNrm, tRough, tAo);
  terrLayer(3.0, w3, uvN * 0.4, uvF * 0.6, dNx * 0.4, dNy * 0.4, dFx * 0.6, dFy * 0.6, tFar, tAlb, tNrm, tRough, tAo);
  terrLayer(4.0, w4, uvN, uvF, dNx, dNy, dFx, dFy, tFar, tAlb, tNrm, tRough, tAo);

  // Pull the two grass scans toward one meadow green so they blend instead of patching.
  float tGrass = w0 + w1;
  tAlb = mix(tAlb, tAlb * vec3(0.8, 1.0, 0.62), w0);
  tAlb = mix(tAlb, tAlb * vec3(0.95, 1.02, 0.8), w1);

  // Large-scale brightness and hue drift so wide shots are not one flat green.
  float tMacro = tNoiseC.r * 0.55 + tNoiseA.b * 0.45;
  tAlb *= 0.8 + 0.42 * tMacro;
  tAlb = mix(tAlb, tAlb * vec3(1.16, 1.05, 0.78), smoothstep(0.5, 0.9, tNoiseA.a * 0.6 + tNoiseC.g * 0.4) * 0.4 * tGrass);
  tAlb = mix(tAlb, tAlb * vec3(0.78, 0.93, 0.8), smoothstep(0.45, 0.9, tNoiseC.a) * 0.5 * tGrass);

  // Damp ground at the waterline, darker still under water.
  tAlb *= mix(0.5, 1.0, smoothstep(-0.6, 0.55, tH));
  tAlb *= mix(1.0, tAo, 0.6);
  diffuseColor.rgb = tAlb;
`;

const NORMAL = /* glsl */ `
  {
    // The terrain is a height field, so the tangent frame follows the world axes.
    // Texture "up" (green) points toward -z because v grows with +z.
    vec3 tT = normalize(vec3(1.0, 0.0, 0.0) - tWN * tWN.x);
    vec3 tB = normalize(vec3(0.0, 0.0, -1.0) + tWN * tWN.z);
    float tStr = 1.0 - tFar * 0.7;
    vec3 tn = normalize(vec3(tNrm.xy * tStr, max(tNrm.z, 0.05)));
    vec3 tWorldN = normalize(tT * tn.x + tB * tn.y + tWN * tn.z);
    normal = normalize((viewMatrix * vec4(tWorldN, 0.0)).xyz);
  }
`;

/**
 * Splat-mapped terrain: grass, rough grass, dirt, rock and sand chosen per pixel from
 * slope, height and noise, sampled at two scales. Built on MeshStandardMaterial so it
 * keeps the engine's lighting, shadows, fog and image-based light.
 */
export function createTerrainMaterial(tex: TerrainTextures): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTerrDiff = { value: tex.diff };
    shader.uniforms.uTerrNor = { value: tex.nor };
    shader.uniforms.uTerrArm = { value: tex.arm };
    shader.uniforms.uNoise = { value: tex.noise };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = position;\nvWNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace('#include <map_fragment>', MAP)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(tRough, 0.55, 1.0);')
      .replace('#include <normal_fragment_maps>', NORMAL);
  };
  mat.customProgramCacheKey = () => 'terrain-splat-v2';
  return mat;
}
