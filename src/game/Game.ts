import { Vector3 } from 'three';
import { MONTH_NAMES, TICK_MS, WORLD } from '../core/constants';
import { CameraInput } from './input';
import { loadPbr, loadTextureArray, loadWarnings } from '../render/assets/loader';
import { makeNoiseTexture, makeWaterNormalTexture } from '../render/assets/procedural';
import { Atmosphere } from '../render/atmosphere';
import { RtsCamera, type CameraPose } from '../render/camera/rtsCamera';
import { Engine } from '../render/engine';
import { TreeRenderer } from '../render/props/treeRenderer';
import { createRoadMaterials } from '../render/roads/roadMaterials';
import { RoadRenderer } from '../render/roads/roadRenderer';
import { ShadowFitter } from '../render/shadows';
import { ToolPreview } from '../render/tools/toolPreview';
import { TERRAIN_LAYERS, createTerrainMaterial } from '../render/terrain/terrainMaterial';
import { TerrainRenderer } from '../render/terrain/terrainRenderer';
import { WaterRenderer } from '../render/water/waterRenderer';
import type { Command, CommandResult } from '../sim/commands';
import { heightAt } from '../sim/map/terrain';
import { TreeSpecies } from '../sim/map/trees';
import { Sim } from '../sim/sim';
import { dateOf } from '../sim/state';
import { actions, ui } from '../ui/store';
import { ToolManager } from './tools/toolManager';

export interface GameOptions {
  seed: number;
  /** Screenshot mode: no edge scrolling, no hints, deterministic start. */
  shots: boolean;
  dev: boolean;
}

const MAX_TICKS_PER_FRAME = 8;

/** Wires the simulation, renderer, input and HUD together and runs the frame loop. */
export class Game {
  readonly sim: Sim;
  readonly engine: Engine;
  readonly rig: RtsCamera;
  readonly atmosphere: Atmosphere;
  readonly shadows: ShadowFitter;
  terrain!: TerrainRenderer;
  water!: WaterRenderer;
  trees!: TreeRenderer;
  roads!: RoadRenderer;
  preview!: ToolPreview;
  tools!: ToolManager;
  input!: CameraInput;
  ready = false;
  frameCount = 0;

  private last = 0;
  private acc = 0;
  private simMs = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private frameMs = 0;
  private lastDay = -1;
  private readonly camPos = new Vector3();

  private constructor(
    readonly canvas: HTMLCanvasElement,
    readonly options: GameOptions,
  ) {
    this.sim = Sim.create(options.seed);
    this.rig = new RtsCamera(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.rig.heightAt = (x, z) => heightAt(this.sim.state.heights, x, z);
    this.engine = new Engine(canvas, this.rig.camera);
    this.atmosphere = new Atmosphere(this.engine.renderer, this.engine.scene);
    this.shadows = new ShadowFitter(this.atmosphere.sun);
  }

  static async create(canvas: HTMLCanvasElement, options: GameOptions): Promise<Game> {
    const game = new Game(canvas, options);
    await game.init();
    return game;
  }

  private async init(): Promise<void> {
    const { engine, sim, atmosphere } = this;
    const state = sim.state;
    const aniso = Math.min(8, engine.renderer.capabilities.getMaxAnisotropy());

    ui.loading.value = 'Loading sky and terrain';
    const [, diff, nor, arm, asphalt, pavement, concrete, grass] = await Promise.all([
      atmosphere.load(),
      loadTextureArray(TERRAIN_LAYERS, 'diff', 1024, aniso),
      loadTextureArray(TERRAIN_LAYERS, 'nor', 1024, aniso),
      loadTextureArray(TERRAIN_LAYERS, 'arm', 1024, aniso),
      loadPbr('asphalt', aniso),
      loadPbr('pavement', aniso),
      loadPbr('concrete', aniso),
      loadPbr('grass', aniso),
    ]);
    const noise = makeNoiseTexture();
    const waterNormal = makeWaterNormalTexture();

    ui.loading.value = 'Building the landscape';
    await nextFrame();
    this.preview = new ToolPreview(() => sim.state.heights);
    engine.scene.add(this.preview.group);
    this.terrain = new TerrainRenderer(state.heights, state.seed, createTerrainMaterial({ diff, nor, arm, noise }, this.preview.grid));
    engine.scene.add(this.terrain.group);
    this.water = new WaterRenderer(state.heights, state.seed, waterNormal, noise, atmosphere.uniforms);
    engine.scene.add(this.water.mesh);
    this.trees = new TreeRenderer(state.trees, state.heights, atmosphere.uniforms, noise);
    engine.scene.add(this.trees.group);
    this.roads = new RoadRenderer(
      state,
      createRoadMaterials({ asphalt, pavement, concrete, grass }, noise),
      this.trees.lodGeometry(TreeSpecies.Oak, 1),
      this.trees.material,
    );
    engine.scene.add(this.roads.group);

    sim.events.on('terrainChanged', (r) => {
      this.terrain.updateRect(r);
      this.water.updateHeights(sim.state.heights);
    });
    sim.events.on('treesChanged', (r) => this.trees.updateRect(r));
    sim.events.on('roadsChanged', (c) => this.roads.onChange(c));
    sim.events.on('speedChanged', (s) => (ui.speed.value = s as 0 | 1 | 2 | 3));

    this.input = new CameraInput(this.canvas, this.rig, () => sim.state.heights, { edgeScroll: !this.options.shots });
    this.tools = new ToolManager(this.canvas, this.rig, sim, this.preview);
    actions.setSpeed = (speed) => void sim.apply({ type: 'setSpeed', speed });
    actions.selectTool = (tool) => this.tools.select(tool);
    actions.setRoadType = (type) => this.tools.setRoadType(type);
    actions.setRoadMode = (mode) => this.tools.setRoadMode(mode);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.onResize);

    this.rig.setPose({ x: WORLD * 0.5, z: WORLD * 0.52, yaw: 0.55, pitch: 0.74, dist: 620 }, true);
    ui.cityName.value = state.cityName;
    ui.speed.value = state.speed;
    ui.showDev.value = this.options.dev && !this.options.shots;
    ui.showHelp.value = !this.options.shots;
    this.onResize();

    // Compile shaders and upload textures before revealing the scene.
    this.last = performance.now();
    this.step(this.last);
    await nextFrame();
    this.step(performance.now());
    await nextFrame();
    if (loadWarnings.length) console.warn('[assets]', loadWarnings.join('; '));
    ui.loading.value = null;
    this.ready = true;
    requestAnimationFrame(this.loop);
  }

  exec(cmd: Command): CommandResult {
    return this.sim.apply(cmd);
  }

  setCamera(pose: Partial<CameraPose>, instant = true): void {
    this.rig.setPose(pose, instant);
  }

  private onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.metaKey || e.ctrlKey) return;
    switch (e.code) {
      case 'Space': {
        e.preventDefault();
        const s = this.sim.state.speed;
        this.sim.apply({ type: 'setSpeed', speed: s === 0 ? 1 : 0 });
        break;
      }
      case 'Digit1':
        this.sim.apply({ type: 'setSpeed', speed: 1 });
        break;
      case 'Digit2':
        this.sim.apply({ type: 'setSpeed', speed: 2 });
        break;
      case 'Digit3':
        this.sim.apply({ type: 'setSpeed', speed: 3 });
        break;
      case 'Backquote':
        ui.showDev.value = !ui.showDev.value;
        break;
    }
  };

  private onResize = (): void => {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.rig.resize(w / h);
    this.engine.resize();
  };

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    this.step(now);
  };

  /** One frame: advance the sim by whole ticks, then update and draw the view. */
  private step(now: number): void {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const state = this.sim.state;

    const t0 = performance.now();
    this.acc += dt * 1000 * state.speed;
    let ticks = 0;
    while (this.acc >= TICK_MS && ticks < MAX_TICKS_PER_FRAME) {
      this.sim.tick();
      this.acc -= TICK_MS;
      ticks++;
    }
    if (ticks === MAX_TICKS_PER_FRAME) this.acc = 0; // fell behind: drop the backlog
    this.simMs = performance.now() - t0;

    this.input?.update(dt);
    const before = this.rig.pose;
    const bx = before.x;
    const bz = before.z;
    const byaw = before.yaw;
    const bdist = before.dist;
    const bpitch = before.pitch;
    this.rig.update(dt);
    const moved =
      Math.abs(before.x - bx) + Math.abs(before.z - bz) > 0.01 ||
      Math.abs(before.yaw - byaw) + Math.abs(before.pitch - bpitch) > 1e-4 ||
      Math.abs(before.dist - bdist) > 0.01;
    this.tools?.update(dt, moved);
    this.preview?.update(dt, before.dist);
    const cam = this.rig.camera;
    this.camPos.copy(cam.position);
    this.atmosphere.update(cam, dt);
    this.shadows.update(cam, this.atmosphere.sunDir, this.rig.focusY, this.rig.pose.dist);
    this.trees?.updateLod(this.camPos);
    this.roads?.update();
    this.engine.render(dt);
    this.frameCount++;

    this.updateHud(dt);
  }

  private updateHud(dt: number): void {
    const state = this.sim.state;
    const d = dateOf(state.tick);
    if (d.totalDays !== this.lastDay) {
      this.lastDay = d.totalDays;
      ui.dateLabel.value = `${d.day} ${MONTH_NAMES[d.month]} ${d.year}`;
    }
    this.fpsFrames++;
    this.fpsTime += dt;
    this.frameMs = this.frameMs * 0.9 + dt * 1000 * 0.1;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
      if (ui.showDev.value) {
        const s = this.engine.stats;
        ui.devText.value =
          `${this.fps.toFixed(0)} fps  ${this.frameMs.toFixed(1)} ms\n` +
          `draws ${s.drawCalls}  tris ${(s.triangles / 1000).toFixed(0)}k\n` +
          `geo ${s.geometries}  tex ${s.textures}\n` +
          `sim ${this.simMs.toFixed(2)} ms  trees ${this.trees?.count ?? 0}\n` +
          `shadow texel ${this.shadows.texel.toFixed(2)} m`;
      }
    }
  }

  /** Numbers for the dev overlay and automated performance checks. */
  stats(): { fps: number; frameMs: number; drawCalls: number; triangles: number; simMs: number; gpu: string; trees: number } {
    const s = this.engine.stats;
    return {
      fps: this.fps,
      frameMs: this.frameMs,
      drawCalls: s.drawCalls,
      triangles: s.triangles,
      simMs: this.simMs,
      gpu: this.engine.gpuName,
      trees: this.trees?.count ?? 0,
    };
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
