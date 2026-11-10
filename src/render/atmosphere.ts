import {
  BackSide,
  Color,
  DataTexture,
  DataUtils,
  DirectionalLight,
  FogExp2,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PMREMGenerator,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import { loadHdri, type HdriRole } from './assets/loader';

const SKY_GLSL = /* glsl */ `
  uniform sampler2D uSkyA;
  uniform sampler2D uSkyB;
  uniform float uBlend;
  uniform float uRotA;
  uniform float uRotB;

  vec3 sampleSky(sampler2D tex, vec3 d, float rot) {
    float u = atan(d.z, d.x) * 0.15915494309 + 0.5 + rot;
    float v = asin(clamp(d.y, -1.0, 1.0)) * 0.31830988618 + 0.5;
    return texture2D(tex, vec2(u, v)).rgb;
  }

  vec3 skyColor(vec3 d) {
    vec3 a = sampleSky(uSkyA, d, uRotA);
    if (uBlend <= 0.001) return a;
    return mix(a, sampleSky(uSkyB, d, uRotB), uBlend);
  }
`;

interface SkyKey {
  texture: DataTexture;
  /** Direction toward the brightest part of the sky (the sun or moon). */
  sunDir: Vector3;
  /** Average colour just above the horizon, linear. */
  horizon: Color;
  /** Average colour of the upper sky, linear. */
  zenith: Color;
}

/**
 * Owns everything that depends on time of day: the sky dome, image-based lighting, the
 * sun, fog, and the shared `uNight` / `uTime` uniforms other materials read.
 *
 * The sky is an HDRI keyframe (later: a blend of two). The same blend is re-rendered into
 * a small equirect with the sun disc clamped out, then prefiltered for IBL. The sun's
 * direct light comes from the DirectionalLight instead, so it can cast shadows and is not
 * counted twice.
 */
export class Atmosphere {
  readonly sunDir = new Vector3(0.4, 0.7, 0.3).normalize();
  readonly sun = new DirectionalLight(0xffffff, 1);
  readonly fog = new FogExp2(0xbfd4e6, 0.00016);
  /** Shared uniforms: add these objects to any material that reacts to time. */
  readonly uniforms = {
    uTime: { value: 0 },
    uNight: { value: 0 },
    uSunDir: { value: this.sunDir },
  };

  /** Overall brightness of sky and image-based light. Tuned so exposure can stay at 1. */
  skyIntensity = 0.55;
  sunIntensity = 5.2;

  private readonly keys = new Map<HdriRole, SkyKey>();
  private readonly dome: Mesh;
  private readonly domeMat: ShaderMaterial;
  private readonly envMat: ShaderMaterial;
  private readonly envScene = new Scene();
  private readonly envCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly envTarget: WebGLRenderTarget;
  private readonly pmrem: PMREMGenerator;
  private pmremTarget: WebGLRenderTarget | null = null;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
  ) {
    this.pmrem = new PMREMGenerator(renderer);
    this.envTarget = new WebGLRenderTarget(1024, 512, {
      type: HalfFloatType,
      magFilter: LinearFilter,
      minFilter: LinearFilter,
      depthBuffer: false,
    });

    const skyUniforms = {
      uSkyA: { value: null as DataTexture | null },
      uSkyB: { value: null as DataTexture | null },
      uBlend: { value: 0 },
      uRotA: { value: 0 },
      uRotB: { value: 0 },
    };

    this.domeMat = new ShaderMaterial({
      uniforms: {
        ...skyUniforms,
        uIntensity: { value: this.skyIntensity },
        uFogColor: { value: this.fog.color },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${SKY_GLSL}
        uniform float uIntensity;
        uniform vec3 uFogColor;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          // Never sample below the horizon: the HDRI ground is hidden by haze anyway.
          vec3 c = skyColor(normalize(vec3(d.x, max(d.y, 0.004), d.z))) * uIntensity;
          // Keep the sun disc bright enough to bloom without blowing the whole frame out.
          c = min(c, vec3(22.0));
          // Haze toward the horizon so distant fogged terrain meets the sky without a seam.
          float haze = smoothstep(0.085, -0.004, d.y);
          c = mix(c, uFogColor, haze * haze);
          gl_FragColor = vec4(c, 1.0);
        }
      `,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this.dome = new Mesh(new SphereGeometry(1, 48, 24), this.domeMat);
    this.dome.scale.setScalar(900);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.dome.matrixAutoUpdate = true;
    scene.add(this.dome);

    this.envMat = new ShaderMaterial({
      uniforms: {
        ...skyUniforms,
        uGround: { value: new Color(0.1, 0.11, 0.07) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${SKY_GLSL}
        uniform vec3 uGround;
        varying vec2 vUv;
        void main() {
          float phi = (vUv.x - 0.5) * 6.28318530718;
          float theta = (vUv.y - 0.5) * 3.14159265359;
          vec3 d = vec3(cos(phi) * cos(theta), sin(theta), sin(phi) * cos(theta));
          vec3 c = skyColor(normalize(vec3(d.x, max(d.y, 0.004), d.z)));
          // Remove the sun disc: its light is supplied by the directional light.
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c *= min(1.0, 6.0 / max(lum, 1e-4));
          // Below the horizon the environment is ground bounce, not sky.
          c = mix(c, uGround, smoothstep(0.02, -0.12, d.y));
          gl_FragColor = vec4(c, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.envMat);
    quad.frustumCulled = false;
    this.envScene.add(quad);

    this.sun.castShadow = true;
    scene.add(this.sun);
    scene.add(this.sun.target);
    scene.fog = this.fog;
  }

  async load(): Promise<void> {
    await this.loadKey('day');
    this.setSky('day');
  }

  private async loadKey(role: HdriRole): Promise<SkyKey> {
    const existing = this.keys.get(role);
    if (existing) return existing;
    const texture = await loadHdri(role);
    const key = analyseSky(texture);
    this.keys.set(role, key);
    return key;
  }

  /** Shows one keyframe sky and rebuilds lighting from it. */
  setSky(role: HdriRole): void {
    const key = this.keys.get(role);
    if (!key) return;
    for (const mat of [this.domeMat, this.envMat]) {
      mat.uniforms.uSkyA!.value = key.texture;
      mat.uniforms.uSkyB!.value = key.texture;
      mat.uniforms.uBlend!.value = 0;
    }
    this.sunDir.copy(key.sunDir);
    // Never let the sun sit so low that shadows stretch across the whole map.
    if (this.sunDir.y < 0.35) {
      this.sunDir.y = 0.35;
      this.sunDir.normalize();
    }

    // Warm the sun slightly against the blue sky fill.
    this.sun.color.setRGB(1.0, 0.94, 0.84);
    this.sun.intensity = this.sunIntensity;

    // Distance haze: the horizon colour pulled a little toward the blue of the upper sky.
    this.fog.color.copy(key.horizon).lerp(key.zenith, 0.12).multiply(new Color(0.94, 0.99, 1.07)).multiplyScalar(this.skyIntensity * 1.45);
    // The lower half of the environment is light bounced off sunlit ground, not sky. It
    // is what lights walls that face away from the sun, so it must not be left dark.
    const zenithLum = key.zenith.r * 0.2126 + key.zenith.g * 0.7152 + key.zenith.b * 0.0722;
    const irradiance = this.sunIntensity * Math.max(this.sunDir.y, 0) + this.skyIntensity * Math.PI * zenithLum;
    const bounce = irradiance / Math.PI / this.skyIntensity;
    // A neutral, slightly warm grey: a mix of grass, paving and asphalt. A greener bounce
    // tints every shaded wall and window olive.
    (this.envMat.uniforms.uGround!.value as Color).setRGB(0.16 * bounce, 0.158 * bounce, 0.138 * bounce);
    this.domeMat.uniforms.uIntensity!.value = this.skyIntensity;
    this.scene.environmentIntensity = this.skyIntensity;
    this.rebuildEnvironment();
  }

  private rebuildEnvironment(): void {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.envTarget);
    r.render(this.envScene, this.envCam);
    r.setRenderTarget(prev);
    const next = this.pmrem.fromEquirectangular(this.envTarget.texture);
    this.scene.environment = next.texture;
    this.pmremTarget?.dispose();
    this.pmremTarget = next;
  }

  update(camera: PerspectiveCamera, dt: number): void {
    this.uniforms.uTime.value += dt;
    this.dome.position.copy(camera.position);
  }
}

/** Finds the sun direction and representative colours by scanning the HDR pixels. */
function analyseSky(texture: DataTexture): SkyKey {
  const img = texture.image as { data: Uint16Array | Float32Array; width: number; height: number };
  const { data, width, height } = img;
  const half = texture.type === HalfFloatType;
  const read = (i: number): number => (half ? DataUtils.fromHalfFloat(data[i]!) : data[i]!);
  const step = Math.max(1, Math.floor(width / 1024));

  let maxLum = 0;
  for (let y = 0; y < height / 2; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const lum = read(i) * 0.2126 + read(i + 1) * 0.7152 + read(i + 2) * 0.0722;
      if (lum > maxLum) maxLum = lum;
    }
  }

  const sun = new Vector3();
  const horizon = new Color(0, 0, 0);
  const zenith = new Color(0, 0, 0);
  let horizonN = 0;
  let zenithN = 0;
  const dir = new Vector3();
  for (let y = 0; y < height / 2; y += step) {
    // Row 0 is the top of the file. With flipY the top row maps to v = 1 (straight up).
    const v = texture.flipY ? 1 - (y + 0.5) / height : (y + 0.5) / height;
    const theta = (v - 0.5) * Math.PI;
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = read(i);
      const g = read(i + 1);
      const b = read(i + 2);
      const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
      const phi = ((x + 0.5) / width - 0.5) * Math.PI * 2;
      if (lum > maxLum * 0.3) {
        dir.set(Math.cos(phi) * Math.cos(theta), Math.sin(theta), Math.sin(phi) * Math.cos(theta));
        sun.addScaledVector(dir, lum);
      }
      // Clamp so the sun and bright cloud edges do not dominate the averages.
      const k = Math.min(1, 4 / Math.max(lum, 1e-4));
      if (theta > 0.02 && theta < 0.16) {
        horizon.r += r * k;
        horizon.g += g * k;
        horizon.b += b * k;
        horizonN++;
      } else if (theta > 0.5) {
        zenith.r += r * k;
        zenith.g += g * k;
        zenith.b += b * k;
        zenithN++;
      }
    }
  }
  if (sun.lengthSq() < 1e-8) sun.set(0.4, 0.7, 0.3);
  sun.normalize();
  horizon.multiplyScalar(1 / Math.max(1, horizonN));
  zenith.multiplyScalar(1 / Math.max(1, zenithN));
  return { texture, sunDir: sun, horizon, zenith };
}
