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
  uniform float uIntA;
  uniform float uIntB;

  vec3 sampleSky(sampler2D tex, vec3 d, float rot) {
    float u = atan(d.z, d.x) * 0.15915494309 + 0.5 + rot;
    float v = asin(clamp(d.y, -1.0, 1.0)) * 0.31830988618 + 0.5;
    return texture2D(tex, vec2(u, v)).rgb;
  }

  vec3 skyColor(vec3 d) {
    vec3 a = sampleSky(uSkyA, d, uRotA) * uIntA;
    if (uBlend <= 0.001) return a;
    return mix(a, sampleSky(uSkyB, d, uRotB) * uIntB, uBlend);
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
  /** Brightness multiplier that brings this sky to a sensible level for exposure 1. */
  intensity: number;
  /** Azimuth of its sun, radians. */
  azimuth: number;
}

/** How high the noon sun climbs, radians above the horizon. */
const SUN_TILT = (58 * Math.PI) / 180;
const DAY_INTENSITY = 0.55;

function lum(c: Color): number {
  return c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Owns everything that depends on time of day: the sky dome, image-based lighting, the
 * sun and moon, fog, and the shared `uNight` / `uTime` uniforms other materials read.
 *
 * The sky is a blend of two HDRI keyframes (day, golden hour, night) chosen by the sun's
 * height, rotated so the sun in the picture sits where the game's sun is. The same blend
 * is re-rendered into a small equirect with the sun disc clamped out and prefiltered for
 * image-based light. Direct light comes from one DirectionalLight, which is the sun by
 * day and a dim blue moon by night, so shadows are cast around the clock.
 */
export class Atmosphere {
  /** Where the sun is, even when it is below the horizon. */
  readonly sunDir = new Vector3(0.4, 0.7, 0.3).normalize();
  /** Direction toward whichever body is lighting the scene: the sun or the moon. */
  readonly lightDir = new Vector3(0.4, 0.7, 0.3).normalize();
  readonly sun = new DirectionalLight(0xffffff, 1);
  readonly fog = new FogExp2(0xbfd4e6, 0.00016);
  /** Shared uniforms: add these objects to any material that reacts to time. */
  readonly uniforms = {
    uTime: { value: 0 },
    uNight: { value: 0 },
    uSunDir: { value: this.sunDir },
  };

  /** Time of day in hours, 0..24. */
  hour = 14.5;
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
  private envHour = -99;
  private envAge = 99;
  private appliedHour = -99;
  private readonly tmpA = new Color();
  private readonly tmpB = new Color();

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
      uIntA: { value: DAY_INTENSITY },
      uIntB: { value: DAY_INTENSITY },
    };

    this.domeMat = new ShaderMaterial({
      uniforms: {
        ...skyUniforms,
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
        uniform vec3 uFogColor;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          // Never sample below the horizon: the HDRI ground is hidden by haze anyway.
          vec3 c = skyColor(normalize(vec3(d.x, max(d.y, 0.004), d.z)));
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
          c *= min(1.0, 3.3 / max(lum, 1e-4));
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
    scene.environmentIntensity = 1;
  }

  async load(): Promise<void> {
    const roles: HdriRole[] = ['day', 'golden', 'night'];
    const textures = await Promise.all(roles.map((r) => loadHdri(r)));
    roles.forEach((role, i) => {
      const key = analyseSky(textures[i]!);
      const z = Math.max(lum(key.zenith), 1e-4);
      // Bring each sky to a level that suits a fixed exposure: bright by day, a dim glow
      // at dusk, and just enough at night to read silhouettes.
      key.intensity = role === 'day' ? DAY_INTENSITY : role === 'golden' ? Math.min(2.5, Math.max(0.3, 0.36 / z)) : Math.min(200, 0.05 / z);
      key.azimuth = Math.atan2(key.sunDir.z, key.sunDir.x);
      this.keys.set(role, key);
    });
    this.apply(true);
  }

  /** Night factor: 0 in daylight, 1 when the sun is well below the horizon. */
  get night(): number {
    return this.uniforms.uNight.value;
  }

  /** Recomputes sun, sky blend, fog and light for the current hour. */
  private apply(forceEnv: boolean): void {
    const day = this.keys.get('day');
    const golden = this.keys.get('golden');
    const night = this.keys.get('night');
    if (!day || !golden || !night) return;
    this.appliedHour = this.hour;

    // The sun rises in the east (+x), peaks in the south (+z) and sets in the west.
    const a = ((this.hour - 6) / 12) * Math.PI;
    this.sunDir.set(Math.cos(a), Math.sin(a) * Math.sin(SUN_TILT), Math.sin(a) * Math.cos(SUN_TILT)).normalize();
    const y = this.sunDir.y;
    const azimuth = Math.atan2(this.sunDir.z, this.sunDir.x);
    this.uniforms.uNight.value = smooth(0.1, -0.1, y);

    // Which two skies, and how far between them.
    let ka = day;
    let kb = golden;
    let blend = 0;
    if (y < -0.14) {
      ka = night;
      kb = night;
    } else if (y < 0.06) {
      ka = golden;
      kb = night;
      blend = 1 - (y + 0.14) / 0.2;
    } else if (y < 0.3) {
      blend = 1 - (y - 0.06) / 0.24;
    }
    const rot = (k: SkyKey): number => (k === night ? 0 : (k.azimuth - azimuth) / (Math.PI * 2));
    for (const mat of [this.domeMat, this.envMat]) {
      const u = mat.uniforms;
      u.uSkyA!.value = ka.texture;
      u.uSkyB!.value = kb.texture;
      u.uBlend!.value = blend;
      u.uRotA!.value = rot(ka);
      u.uRotB!.value = rot(kb);
      u.uIntA!.value = ka.intensity;
      u.uIntB!.value = kb.intensity;
    }

    // Direct light: the sun while it is up, then the moon.
    const light = this.sun;
    if (y > -0.06) {
      this.lightDir.copy(this.sunDir);
      // Keep the light a little above the horizon so shadows do not stretch forever.
      if (this.lightDir.y < 0.07) {
        this.lightDir.y = 0.07;
        this.lightDir.normalize();
      }
      const warm = smooth(0.02, 0.3, y);
      light.color.setRGB(1.0, 0.55 + 0.39 * warm, 0.3 + 0.54 * warm);
      light.intensity = this.sunIntensity * smooth(-0.04, 0.15, y);
    } else {
      this.lightDir.set(-this.sunDir.x, Math.max(0.5, -this.sunDir.y), -this.sunDir.z).normalize();
      light.color.setRGB(0.45, 0.6, 1.0);
      light.intensity = 1.5 * smooth(-0.05, -0.12, y);
    }

    // Fog: the blended horizon colour, pulled slightly toward the upper sky.
    const fogOf = (k: SkyKey, out: Color): Color => out.copy(k.horizon).lerp(k.zenith, 0.12).multiplyScalar(k.intensity * 1.45);
    this.fog.color.copy(fogOf(ka, this.tmpA)).lerp(fogOf(kb, this.tmpB), blend);
    this.fog.color.r *= 0.94;
    this.fog.color.b *= 1.07;

    // The lower half of the environment is light bounced off the lit ground, not sky. It
    // lights walls that face away from the sun. Neutral grey: a greener bounce tints every
    // shaded wall and window olive.
    const skyLum = lum(ka.zenith) * ka.intensity * (1 - blend) + lum(kb.zenith) * kb.intensity * blend;
    const bounce = (light.intensity * Math.max(this.lightDir.y, 0) + Math.PI * skyLum) / Math.PI;
    (this.envMat.uniforms.uGround!.value as Color).setRGB(0.16 * bounce, 0.158 * bounce, 0.138 * bounce);

    // Re-filtering the environment costs a few milliseconds: only do it when the sky has
    // visibly moved on, and not more than a couple of times a second.
    let dh = Math.abs(this.hour - this.envHour);
    if (dh > 12) dh = 24 - dh;
    if (forceEnv || (dh > 0.07 && this.envAge > 0.4)) this.rebuildEnvironment();
  }

  private rebuildEnvironment(): void {
    this.envHour = this.hour;
    this.envAge = 0;
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

  /** Jumps to a time of day and rebuilds the lighting immediately. */
  setHour(hour: number): void {
    this.hour = ((hour % 24) + 24) % 24;
    this.apply(true);
  }

  update(camera: PerspectiveCamera, dt: number): void {
    this.uniforms.uTime.value += dt;
    this.envAge += dt;
    this.dome.position.copy(camera.position);
    if (this.hour !== this.appliedHour || this.envHour !== this.hour) this.apply(false);
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
  return { texture, sunDir: sun, horizon, zenith, intensity: 1, azimuth: 0 };
}
