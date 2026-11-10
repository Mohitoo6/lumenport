import { MeshStandardMaterial, type DataArrayTexture, type Vector4 } from 'three';

export interface CityTextures {
  diff: DataArrayTexture;
  nor: DataArrayTexture;
  arm: DataArrayTexture;
}

const VERT_PARS = /* glsl */ `
  attribute vec3 aTint;
  attribute vec4 aA;
  attribute vec4 aB;
  varying vec3 vTint;
  varying vec4 vA;
  varying vec4 vB;
  varying vec2 vTexUv;
  varying vec2 vWorldXZ;
`;

const VERT_MAIN = /* glsl */ `
  vWorldXZ = position.xz;
  vTint = aTint;
  vA = aA;
  vB = aB;
  vTexUv = uv;
`;

const FRAG_PARS = /* glsl */ `
  precision highp sampler2DArray;
  uniform sampler2DArray uCityDiff;
  uniform sampler2DArray uCityNor;
  uniform sampler2DArray uCityArm;
  uniform float uNight;
  uniform vec4 uSel;
  uniform vec4 uSelColor;
  varying vec2 vWorldXZ;
  varying vec3 vTint;
  varying vec4 vA;
  varying vec4 vB;
  varying vec2 vTexUv;

  float cHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  // Tangent frame from screen-space derivatives (no tangent attribute needed).
  mat3 cTangentFrame(vec3 eyePos, vec3 n, vec2 uv) {
    vec3 q0 = dFdx(eyePos);
    vec3 q1 = dFdy(eyePos);
    vec2 st0 = dFdx(uv);
    vec2 st1 = dFdy(uv);
    vec3 q1perp = cross(q1, n);
    vec3 q0perp = cross(n, q0);
    vec3 T = q1perp * st0.x + q0perp * st1.x;
    vec3 B = q1perp * st0.y + q0perp * st1.y;
    float det = max(dot(T, T), dot(B, B));
    float scale = det == 0.0 ? 0.0 : inversesqrt(det);
    return mat3(T * scale, B * scale, n);
  }
`;

// Runs in place of <map_fragment>. Decides, per pixel, whether this is wall, frame or
// glass, and leaves cGlass / cEmissive / cRough / cMetal for the later chunks.
const FRAG_MAP = /* glsl */ `
  float cLayer = vA.z;
  vec3 cAlb = texture(uCityDiff, vec3(vTexUv, cLayer)).rgb * vTint;
  vec3 cArm = texture(uCityArm, vec3(vTexUv, cLayer)).rgb;
  float cRough = cArm.g;
  float cMetal = 0.0;
  float cGlass = 0.0;
  vec3 cEmissive = vec3(0.0);
  vec2 cWinId = vec2(0.0);
  cAlb *= mix(1.0, cArm.r, 0.7);
  // Grime: walls darken a little toward the ground.
  cAlb *= 0.9 + 0.1 * smoothstep(0.0, 2.5, vA.y);

  float cStyle = vB.z;
  if (cStyle > 5.5) {
    // Sign panel: flat colour by day, glowing by night.
    cAlb = vTint * 0.85;
    cRough = 0.45;
    cEmissive = vTint * uNight * 2.6;
  } else if (cStyle > 0.5) {
    vec2 cSize = vB.xy;
    vec2 cCell = vA.xy / cSize;
    cWinId = floor(cCell);
    vec2 cF = fract(cCell);
    float cRnd = cHash(cWinId + vA.w * 157.0);

    // Window opening inside the bay, as fractions of the bay.
    vec2 cLo;
    vec2 cHi;
    float cMullX = 1.0; // panes across
    float cMullY = 1.0;
    if (cStyle < 1.5) {
      float w = vB.w;
      cLo = vec2(0.5 - w * 0.5, 0.31);
      cHi = vec2(0.5 + w * 0.5, 0.8);
      cMullX = 2.0;
      cMullY = 2.0;
    } else if (cStyle < 2.5) {
      cLo = vec2(0.0, 0.33);
      cHi = vec2(1.0, 0.8);
      cMullX = 2.0;
    } else if (cStyle < 3.5) {
      cLo = vec2(0.0, 0.26);
      cHi = vec2(1.0, 1.0);
      cMullX = 1.0;
    } else if (cStyle < 4.5) {
      cLo = vec2(0.05, 0.13);
      cHi = vec2(0.95, 0.84);
      cMullX = 2.0;
    } else {
      cLo = vec2(0.14, 0.58);
      cHi = vec2(0.86, 0.86);
      cMullX = 3.0;
    }

    // Signed distance to the opening edge, in metres (positive inside).
    vec2 cPm = cF * cSize;
    vec2 cD = min(cPm - cLo * cSize, cHi * cSize - cPm);
    float cIn = min(cD.x, cD.y);
    float cAa = max(fwidth(cPm.x), fwidth(cPm.y)) * 0.75 + 1e-4;
    float cWin = smoothstep(-cAa, cAa, cIn);

    // Frame around the opening and mullions between panes.
    float cFrameW = cStyle > 2.5 && cStyle < 3.5 ? 0.045 : 0.07;
    float cFrame = 1.0 - smoothstep(cFrameW - cAa, cFrameW + cAa, cIn);
    vec2 cPane = (cPm - cLo * cSize) / ((cHi - cLo) * cSize);
    vec2 cPaneD = abs(fract(cPane * vec2(cMullX, cMullY)) - 0.5) * (cHi - cLo) * cSize / vec2(cMullX, cMullY);
    vec2 cPaneHalf = 0.5 * (cHi - cLo) * cSize / vec2(cMullX, cMullY);
    float cMull = 1.0 - smoothstep(0.025 - cAa, 0.025 + cAa, min(cPaneHalf.x - cPaneD.x, cPaneHalf.y - cPaneD.y));
    float cBar = max(cFrame, cMull);

    // When bays shrink to a few pixels, fade to the average look instead of shimmering.
    float cDetail = 1.0 - smoothstep(0.3, 0.75, max(fwidth(cCell.x), fwidth(cCell.y)));
    cBar *= cDetail;

    cGlass = cWin * (1.0 - cBar);
    // Spandrel panel under curtain-wall glazing: an opaque band in the glass colour.
    if (cStyle > 2.5 && cStyle < 3.5) {
      float cSp = 1.0 - smoothstep(cLo.y * cSize.y - cAa, cLo.y * cSize.y + cAa, cPm.y);
      cAlb = mix(cAlb, vTint * 0.32, cSp);
      cRough = mix(cRough, 0.35, cSp);
      cMetal = mix(cMetal, 0.5, cSp);
    }

    // Frames: pale on houses and shops, dark anodised metal on offices.
    vec3 cFrameCol = cStyle < 1.5 || (cStyle > 3.5 && cStyle < 4.5) ? vec3(0.78, 0.77, 0.74) : vec3(0.1, 0.11, 0.12);
    cAlb = mix(cAlb, cFrameCol, cWin * cBar);
    cRough = mix(cRough, 0.5, cWin * cBar);
    // Lintel shadow: the glass sits back from the wall face.
    float cRecess = cWin * (1.0 - smoothstep(0.0, 0.16, cHi.y * cSize.y - cPm.y)) * cDetail;

    // Glass: a tinted mirror for the sky, with some windows showing blinds instead.
    vec3 cTintGlass = cStyle > 2.5 && cStyle < 3.5 ? vTint : vec3(0.36, 0.4, 0.44);
    // Some windows have a blind pulled part of the way down.
    float cDrop = 0.2 + 0.7 * fract(cRnd * 7.31);
    float cBlind = step(0.62, cRnd) * step(1.0 - cDrop, cPane.y) * (cStyle < 2.5 ? 1.0 : 0.3);
    vec3 cGlassCol = mix(cTintGlass * (0.8 + 0.3 * cRnd), vec3(0.5, 0.48, 0.43), cBlind);
    cGlassCol *= 1.0 - 0.45 * cRecess;
    cAlb = mix(cAlb, cGlassCol, cGlass);
    cRough = mix(cRough, mix(0.07, 0.7, cBlind), cGlass);
    cMetal = mix(cMetal, mix(0.92, 0.0, cBlind), cGlass);

    // Night: a share of the windows are lit, each in a slightly different warm white.
    float cLitShare = cStyle > 3.5 && cStyle < 4.5 ? 0.85 : mix(0.22, 0.6, cHash(vec2(vA.w * 91.0, 3.0)));
    float cLit = step(1.0 - cLitShare * uNight, cHash(cWinId * 1.37 + vA.w * 311.0));
    vec3 cLamp = mix(vec3(1.0, 0.74, 0.42), vec3(0.82, 0.9, 1.0), step(0.82, cHash(cWinId + 7.0 + vA.w * 53.0)));
    cEmissive = cLamp * cLit * cGlass * uNight * (1.6 + 1.8 * cRnd);
    // A lit room hides the reflection.
    cMetal *= 1.0 - cLit * uNight * 0.85;
  }
  // Buildings inside the tool's selection rectangle take its colour.
  if (uSelColor.a > 0.0 && vWorldXZ.x > uSel.x && vWorldXZ.y > uSel.y && vWorldXZ.x < uSel.z && vWorldXZ.y < uSel.w) {
    cAlb = mix(cAlb, uSelColor.rgb, uSelColor.a * 0.7);
    cMetal *= 0.3;
    cEmissive += uSelColor.rgb * uSelColor.a * 0.25;
  }
  diffuseColor.rgb = cAlb;
`;

const FRAG_NORMAL = /* glsl */ `
  {
    vec3 cN = texture(uCityNor, vec3(vTexUv, cLayer)).xyz * 2.0 - 1.0;
    mat3 cTbn = cTangentFrame(-vViewPosition, normal, vTexUv);
    vec3 cBumped = normalize(cTbn * vec3(cN.xy * 0.9, cN.z));
    // Each pane sits at a slightly different angle, so reflections vary across a facade.
    vec3 cTilt = vec3(cHash(cWinId + 1.7) - 0.5, cHash(cWinId + 9.1) - 0.5, 0.0) * 0.05;
    // Seen from above, a vertical pane mirrors the street. Leaning the normal skyward makes
    // it reflect the low sky instead, which is what gives glass its daytime sparkle.
    vec3 cUp = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
    vec3 cFlat = normalize(normal + cUp * 0.4 + cTbn[0] * cTilt.x + cTbn[1] * cTilt.y);
    normal = normalize(mix(cBumped, cFlat, cGlass));
  }
`;

/**
 * The one material every building surface uses. Wall, roof and ground finishes come from
 * texture arrays selected per vertex; windows are drawn procedurally from facade
 * coordinates, so one draw call per chunk covers every building style, and windows can
 * light up at night without any extra geometry.
 */
export function createCityMaterial(
  tex: CityTextures,
  shared: { uNight: { value: number } },
  fx: { sel: { value: Vector4 }; selColor: { value: Vector4 } },
): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ roughness: 1, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCityDiff = { value: tex.diff };
    shader.uniforms.uCityNor = { value: tex.nor };
    shader.uniforms.uCityArm = { value: tex.arm };
    shader.uniforms.uNight = shared.uNight;
    shader.uniforms.uSel = fx.sel;
    shader.uniforms.uSelColor = fx.selColor;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <map_fragment>', FRAG_MAP)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(cRough, 0.05, 1.0);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = cMetal;')
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += cEmissive;');
  };
  m.customProgramCacheKey = () => 'city-v5';
  return m;
}
