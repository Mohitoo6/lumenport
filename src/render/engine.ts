import {
  FloatType,
  HalfFloatType,
  NearestFilter,
  NoToneMapping,
  PCFShadowMap,
  RGBAFormat,
  RedFormat,
  SRGBColorSpace,
  Scene,
  WebGLRenderTarget,
  WebGLRenderer,
  type PerspectiveCamera,
} from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export interface FrameStats {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

/**
 * Renderer and post-processing chain:
 *   scene (linear HDR, half float) -> N8AO -> bloom -> ACES tone map -> vignette -> SMAA -> sRGB
 */
export class Engine {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly composer: EffectComposer;
  readonly ao: N8AOPostPass;
  readonly bloom: BloomEffect;
  readonly stats: FrameStats = { drawCalls: 0, triangles: 0, geometries: 0, textures: 0 };
  /** Device pixel ratio in use; lowered by the dynamic resolution logic if frames run long. */
  pixelRatio: number;
  /** The most the pixel ratio may be raised to (set by the graphics preset). */
  maxPixelRatio: number;
  gpuName = 'unknown';

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly camera: PerspectiveCamera,
  ) {
    const renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      stencil: false,
      depth: false,
      powerPreference: 'high-performance',
    });
    this.renderer = renderer;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NoToneMapping; // tone mapping happens in the composer
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.info.autoReset = false;
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.pixelRatio = this.maxPixelRatio;
    renderer.setPixelRatio(this.pixelRatio);

    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) this.gpuName = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));

    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);

    this.composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, camera));

    this.ao = new N8AOPostPass(this.scene, camera, w, h);
    patchHalfResTarget(this.ao);
    const ao = this.ao.configuration;
    ao.aoRadius = 3.5;
    ao.distanceFalloff = 0.7;
    ao.intensity = 1.7;
    ao.aoSamples = 12;
    ao.denoiseSamples = 6;
    ao.denoiseRadius = 10;
    ao.halfRes = true;
    ao.depthAwareUpsampling = true;
    ao.gammaCorrection = false;
    ao.color.setRGB(0.04, 0.05, 0.09);
    this.composer.addPass(this.ao);

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 2.4,
      luminanceSmoothing: 0.6,
      intensity: 0.55,
      radius: 0.72,
      levels: 7,
    });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
    this.composer.addPass(new EffectPass(camera, this.bloom, tone, vignette));
    this.composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
  }

  /** Applies a graphics preset's resolution cap and ambient occlusion. */
  setQuality(maxDpr: number, ao: boolean): void {
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, maxDpr);
    this.pixelRatio = this.maxPixelRatio;
    (this.ao as unknown as { enabled: boolean }).enabled = ao;
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
  }

  render(dt: number): void {
    const info = this.renderer.info;
    info.reset();
    this.composer.render(dt);
    this.stats.drawCalls = info.render.calls;
    this.stats.triangles = info.render.triangles;
    this.stats.geometries = info.memory.geometries;
    this.stats.textures = info.memory.textures;
  }
}

/**
 * n8ao 2.0.1 builds its half-resolution depth/normal target from a WebGLRenderTarget
 * subclass whose `texture` getter returns an array. three r187 reads `texture` as a single
 * texture and throws. Swap in a native two-attachment render target with the same layout.
 */
export function patchHalfResTarget(pass: N8AOPostPass): void {
  const p = pass as unknown as {
    configureHalfResTargets: () => void;
    depthDownsampleTarget: WebGLRenderTarget | null;
  };
  const original = p.configureHalfResTargets.bind(p);
  p.configureHalfResTargets = () => {
    original();
    const old = p.depthDownsampleTarget;
    if (!old) return;
    const rt = new WebGLRenderTarget(old.width, old.height, { count: 2, depthBuffer: false });
    const [depth, normal] = rt.textures;
    depth!.format = RedFormat;
    depth!.type = FloatType;
    normal!.format = RGBAFormat;
    normal!.type = HalfFloatType;
    for (const t of rt.textures) {
      t.minFilter = NearestFilter;
      t.magFilter = NearestFilter;
      t.generateMipmaps = false;
    }
    old.dispose();
    p.depthDownsampleTarget = rt;
  };
}
