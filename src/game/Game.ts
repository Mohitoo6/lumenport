import { Vector3 } from 'three';
import { MONTH_NAMES, SEASONS, SPEED_FACTOR, START_YEAR, TICK_MS, WORLD } from '../core/constants';
import { GameAudio } from '../audio/audio';
import { saves } from '../platform/idb';
import { cloneState, metaOf, validateState } from '../sim/save/serialize';
import { createState, type GameState } from '../sim/state';
import { CouncilController } from './council/controller';
import { browserKV } from './council/storage';
import { saveStats } from './council/telemetry';
import { AssistantController } from './assistant/controller';
import { cityAlerts } from './assistant/situation';
import type { RoadType } from '../sim/roads/types';
import { CameraInput } from './input';
import { loadPbr, loadTextureArray, loadWarnings } from '../render/assets/loader';
import { makeNoiseTexture, makeWaterNormalTexture } from '../render/assets/procedural';
import { Atmosphere } from '../render/atmosphere';
import { Rain } from '../render/weather/rain';
import { Planes } from '../render/airport/planes';
import { Pedestrians } from '../render/people/pedestrians';
import { SEASON_SPECS, skyAt, type Sky, type Weather } from '../sim/seasons';
import { RtsCamera, type CameraPose } from '../render/camera/rtsCamera';
import { BuildingRenderer } from '../render/buildings/buildingRenderer';
import { TownHallDoors, doorFrame, townHallOf } from '../render/buildings/townHallDoors';
import { MetroRenderer } from '../render/metro/metroRenderer';
import { Chamber } from '../render/council/chamber';
import { Cinematic, type CinePhase } from '../render/council/cinematic';
import { CHIEF_SECRETARY, MINISTER_BY_ID } from './council/ministries';
import { createCityMaterial } from '../render/buildings/cityMaterial';
import { CITY_LAYERS } from '../render/buildings/geo';
import { Engine } from '../render/engine';
import { QUALITY, loadQuality, saveQuality, type Quality, type QualityId } from '../render/quality';
import { TreeRenderer } from '../render/props/treeRenderer';
import { createRoadMaterials } from '../render/roads/roadMaterials';
import { RoadRenderer } from '../render/roads/roadRenderer';
import { DataOverlay } from '../render/overlays/dataOverlay';
import { ZoneOverlay } from '../render/overlays/zoneOverlay';
import { ShadowFitter } from '../render/shadows';
import { ToolPreview } from '../render/tools/toolPreview';
import { VehicleRenderer } from '../render/traffic/vehicleRenderer';
import { TERRAIN_LAYERS, createTerrainMaterial } from '../render/terrain/terrainMaterial';
import { TerrainRenderer } from '../render/terrain/terrainRenderer';
import { WaterRenderer } from '../render/water/waterRenderer';
import type { Command, CommandResult } from '../sim/commands';
import { emptyReport, projectBudget } from '../sim/economy/budget';
import { capacityOf } from '../sim/economy/capacity';
import { FACILITIES, FacilityKind, Service } from '../sim/facilities';
import { POWERED, WATERED } from '../sim/utilities/network';
import { DENSITY_NAMES, ZONE_NAMES, ZoneType, stageOf, zoneDensity, zoneType } from '../sim/zoning/zones';
import { CELL, MAP } from '../core/constants';
import { heightAt } from '../sim/map/terrain';
import { TreeSpecies } from '../sim/map/trees';
import { Sim } from '../sim/sim';
import { dateOf } from '../sim/state';
import { actions, ui } from '../ui/store';
import { ToolManager } from './tools/toolManager';

export interface GameOptions {
  seed: number;
  /** Council mode from the URL: 'demo' forces scripted ministers and enables auto requests in shots mode. */
  council?: string;
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
  buildings!: BuildingRenderer;
  vehicles!: VehicleRenderer;
  preview!: ToolPreview;
  zones!: ZoneOverlay;
  overlay!: DataOverlay;
  private inspectId = -1;
  private overlayTimer = 0;
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
  private hudTimer = 1;
  private clockHeld = false;
  /** A fixed time of day for scripted runs, or null to follow the simulation. */
  private heldHour: number | null = null;
  readonly audio = new GameAudio();
  council!: CouncilController;
  assistant!: AssistantController;
  doors!: TownHallDoors;
  metro!: MetroRenderer;
  cinematic!: Cinematic;
  /** The council chamber, built the first time the council sits. */
  private chamber: Chamber | null = null;
  private readonly lookTmp = new Vector3();
  private rain: Rain | null = null;
  private planes: Planes | null = null;
  private people: Pedestrians | null = null;
  /** A sky set by a script (for screenshots), instead of the one the calendar gives. */
  private heldSky: Sky | null = null;
  /** The weather a script asked to show in the top bar along with `heldSky`. */
  private heldWeather: Weather | null = null;
  private quality: Quality = QUALITY[loadQuality()];
  /** The shadow map is redrawn only when something that casts or receives shadows changed. */
  private shadowDirty = true;
  private readonly shadowDir = new Vector3();
  private carShadows = true;
  private lastInput = 0;
  private lastMove = 0;
  private lastFrame = 0;
  /** Frame rate the loop is pacing itself to right now. */
  targetFps = 60;
  private autosaveTimer = 0;
  private slowFrames = 0;
  private fastSeconds = 0;
  private resCooldown = 0;
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
    this.engine.renderer.shadowMap.autoUpdate = false;
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
    ui.loading.value = 'Loading building materials';
    const [cityDiff, cityNor, cityArm] = await Promise.all([
      loadTextureArray(CITY_LAYERS, 'diff', 512, aniso),
      loadTextureArray(CITY_LAYERS, 'nor', 512, aniso),
      loadTextureArray(CITY_LAYERS, 'arm', 512, aniso),
    ]);
    const noise = makeNoiseTexture();
    const waterNormal = makeWaterNormalTexture();

    ui.loading.value = 'Building the landscape';
    await nextFrame();
    this.preview = new ToolPreview(() => sim.state.heights);
    engine.scene.add(this.preview.group);
    this.zones = new ZoneOverlay(state.zone);
    this.preview.fx.zoneTex.value = this.zones.texture;
    this.preview.zoneOverlay = this.zones;
    this.overlay = new DataOverlay();
    this.preview.fx.overlayTex.value = this.overlay.texture;
    this.preview.fx.overlayAlpha = this.overlay.alpha;
    this.terrain = new TerrainRenderer(state.heights, state.seed, createTerrainMaterial({ diff, nor, arm, noise }, this.preview.fx, atmosphere.uniforms));
    engine.scene.add(this.terrain.group);
    this.water = new WaterRenderer(state.heights, state.seed, waterNormal, noise, atmosphere.uniforms);
    engine.scene.add(this.water.mesh);
    this.trees = new TreeRenderer(state.trees, state.heights, atmosphere.uniforms, noise);
    engine.scene.add(this.trees.group);
    this.roads = new RoadRenderer(
      state,
      createRoadMaterials({ asphalt, pavement, concrete, grass }, noise, this.preview.fx),
      this.trees.lodGeometry(TreeSpecies.Oak, 1),
      this.trees.material,
      atmosphere.uniforms.uNight,
    );
    engine.scene.add(this.roads.group);
    this.buildings = new BuildingRenderer(
      state.buildings,
      createCityMaterial({ diff: cityDiff, nor: cityNor, arm: cityArm }, atmosphere.uniforms, this.preview.fx),
      this.trees.lodGeometry(TreeSpecies.Oak, 1),
      this.trees.material,
    );
    engine.scene.add(this.buildings.group);
    this.vehicles = new VehicleRenderer();
    engine.scene.add(this.vehicles.group);
    this.doors = new TownHallDoors();
    engine.scene.add(this.doors.group);
    this.metro = new MetroRenderer();
    engine.scene.add(this.metro.group);
    this.metro.rebuild(state);
    this.preview.metroPreview = (pts, ok) => this.metro.setPreview(this.sim.state, pts, ok);
    sim.events.on('metroChanged', () => {
      this.metro.rebuild(this.sim.state);
      this.shadowDirty = true;
    });
    this.cinematic = new Cinematic(this.canvas.parentElement ?? document.body, this.doors);
    this.cinematic.onPhase = (p) => this.onCinePhase(p);
    this.cinematic.onInside = () => {
      if (this.cinematic.inside) this.chamber?.enterFromDoor();
      this.onCinePhase(this.cinematic.phase);
    };

    const dirty = (): void => {
      this.shadowDirty = true;
    };
    for (const ev of ['terrainChanged', 'treesChanged', 'roadsChanged', 'buildingsChanged', 'stateReplaced'] as const) sim.events.on(ev, dirty);
    sim.events.on('terrainChanged', (r) => {
      this.terrain.updateRect(r);
      this.water.updateHeights(sim.state.heights);
    });
    sim.events.on('treesChanged', (r) => this.trees.updateRect(r));
    sim.events.on('roadsChanged', (c) => this.roads.onChange(c));
    sim.events.on('buildingsChanged', (c) => {
      this.buildings.onChange(c);
      this.doors.attach(townHallOf(sim.state.buildings));
    });
    sim.events.on('zonesChanged', (r) => this.zones.update(r));
    sim.events.on('speedChanged', (s) => (ui.speed.value = s as 0 | 1 | 2 | 3));

    this.input = new CameraInput(this.canvas, this.rig, () => sim.state.heights, { edgeScroll: !this.options.shots });
    this.tools = new ToolManager(
      this.canvas,
      this.rig,
      sim,
      this.preview,
      (id) => this.buildings.heightOf(id),
      (id) => {
        this.inspectId = id;
        this.hudTimer = 1;
      },
    );
    actions.setSpeed = (speed) => void sim.apply({ type: 'setSpeed', speed });
    actions.selectTool = (tool) => this.tools.select(tool);
    actions.setRoadType = (type) => this.tools.setRoadType(type);
    actions.setRoadMode = (mode) => this.tools.setRoadMode(mode);
    actions.setZone = (type, density) => this.tools.setZone(type as 0 | 1 | 2 | 3, density as 1 | 2 | 3);
    actions.setFacility = (kind) => this.tools.setFacility(kind);
    actions.setZoneMode = (mode) => this.tools.setZoneMode(mode);
    this.council = new CouncilController({
      sim,
      cityName: () => sim.state.cityName,
      lookAt: (x, z) => this.rig.setPose({ x, z, dist: Math.max(260, Math.min(this.rig.goal.dist, 700)) }),
      speed: () => sim.state.speed,
      setSpeed: (speed) => void sim.apply({ type: 'setSpeed', speed }),
      chime: (kind) => this.audio.play(kind === 'request' ? 'notify' : 'gavel'),
    });
    this.council.auto = !this.options.shots || this.options.council !== undefined;
    this.council.forceDemo = this.options.council === 'demo';
    actions.convene = (key) => void this.convene(key);
    actions.startCouncil = (note, lang, demo) => this.council.start(note, lang, demo);
    actions.approveOption = (id, withLoan) => this.council.approve(id, withLoan);
    actions.skipSpeech = () => this.council.skip();
    actions.closeCouncil = () => this.closeCouncil();
    this.assistant = new AssistantController({
      sim,
      issues: () => this.council.issues.map((i) => ({ key: i.key, title: i.title, severity: i.severity })),
      tool: () => this.toolLabel(),
      hour: () => this.simHour(),
    });
    // The assistant's calls are counted with the council's: one set of AI numbers.
    this.assistant.onCall = (call) => {
      ui.assistantCalls.value = [call, ...ui.assistantCalls.value].slice(0, 8);
      if (call.promptTokens === 0) return;
      ui.aiStats.value = { ...ui.aiStats.value, assistantCalls: ui.aiStats.value.assistantCalls + 1, assistantTokens: ui.aiStats.value.assistantTokens + call.promptTokens + call.completionTokens };
      saveStats(browserKV(), ui.aiStats.value);
    };
    actions.askAssistant = (q) => void this.assistant.ask(q);
    actions.clearAssistant = () => this.assistant.clear();
    actions.assistantAction = (a) => {
      switch (a.type) {
        case 'council':
          ui.assistant.value = { ...ui.assistant.value, open: false };
          this.convene(a.issue);
          break;
        case 'tool':
          if (a.tool === 'road' || a.tool === 'avenue') this.tools.setRoadType((a.tool === 'avenue' ? 1 : 0) as RoadType);
          else if (a.tool === 'zone') this.tools.setZone(a.zone ?? 1, 1);
          else if (a.tool === 'place' && a.facility) this.tools.setFacility(a.facility);
          else if (a.tool === 'bulldoze') this.tools.select('bulldoze');
          break;
        case 'view':
          actions.setOverlay(a.overlay as Parameters<typeof actions.setOverlay>[0]);
          break;
        case 'budget':
          ui.showBudget.value = true;
          break;
      }
    };
    actions.dismissRequest = () => this.council.dismissRequest();
    actions.lookAt = (x, z) => this.rig.setPose({ x, z });
    actions.setOverlay = (id) => {
      sim.refreshFields();
      this.overlay.set(id, sim);
      ui.overlay.value = id;
    };
    actions.cycleTimeMode = () => {
      const next = ui.timeMode.value === 'auto' ? 'day' : ui.timeMode.value === 'day' ? 'night' : 'auto';
      ui.timeMode.value = next;
      this.clockHeld = false;
    };
    actions.newCity = (seed, sandbox) => {
      // Keep the city being left behind, in case this was a mistake.
      void this.saveTo('autosave').then(() => {
        const next = createState(seed);
        next.sandbox = sandbox;
        this.loadState(next);
        ui.menuNote.value = 'New city started. The previous one is in Autosave.';
      });
    };
    actions.save = (slot) => void this.saveTo(slot).then((ok) => (ui.menuNote.value = ok ? 'City saved.' : 'Could not save: storage is unavailable.'));
    actions.load = (slot) => void this.loadFrom(slot);
    actions.refreshSaves = () => void this.refreshSaves();
    actions.setMuted = (m) => {
      this.audio.setMuted(m);
      ui.muted.value = m;
    };
    ui.muted.value = this.audio.muted;
    sim.events.on('stateReplaced', () => this.onStateReplaced());
    sim.events.on('command', ({ cmd, result }) => {
      this.assistant?.noteCommand(cmd, result);
      if (!result.ok) {
        if (cmd.type !== 'setTax' && result.reason !== 'Too short') this.audio.play('error');
        return;
      }
      switch (cmd.type) {
        case 'buildRoad':
        case 'placeFacility':
          this.audio.play('place');
          break;
        case 'zoneRect':
          this.audio.play('zone');
          break;
        case 'bulldozeRoad':
        case 'bulldozeBuilding':
          this.audio.play('bulldoze');
          break;
        case 'takeLoan':
          this.audio.play('cash');
          break;
        case 'setSpeed':
          this.audio.play('click');
          break;
      }
    });
    actions.closeInspect = () => {
      this.inspectId = -1;
      ui.inspect.value = null;
    };
    actions.setTax = (zone, rate) => {
      sim.apply({ type: 'setTax', zone, rate });
      this.hudTimer = 1;
    };
    actions.takeLoan = (tier) => {
      sim.apply({ type: 'takeLoan', tier });
      this.hudTimer = 1;
    };
    window.addEventListener('keydown', this.onKey);
    // Any input counts as activity: the loop runs at full rate for a moment afterwards.
    for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown'] as const) window.addEventListener(ev, this.onActivity, { passive: true });
    actions.setQuality = (id) => this.applyQuality(id, true);
    this.applyQuality(this.quality.id, false);
    window.addEventListener('resize', this.onResize);

    // Every city has a town hall from the start; screenshot runs found it when they need it.
    if (!this.options.shots) this.ensureTownHall();
    this.rig.setPose({ x: WORLD * 0.5, z: WORLD * 0.52, yaw: 0.55, pitch: 0.74, dist: 620 }, true);
    ui.cityName.value = state.cityName;
    ui.speed.value = state.speed;
    // Off by default even in dev builds; backtick shows it.
    ui.showDev.value = false;
    ui.showHelp.value = !this.options.shots;
    // Screenshot runs hold the afternoon light unless a test asks otherwise.
    ui.timeMode.value = this.options.shots ? 'day' : 'auto';
    // Scripted runs sit at mid-afternoon, with midday traffic, unless a script sets the time.
    this.heldHour = this.options.shots ? 14.5 : null;
    this.atmosphere.setHour(this.options.shots ? 14.5 : this.simHour());
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
    // While the council sits, the city is paused and only Escape (close) applies.
    if (ui.council.value) {
      if (e.code === 'Escape') this.closeCouncil();
      // The AI inspector can be opened at any point of a meeting.
      else if (e.code === 'KeyI' && !e.metaKey && !e.ctrlKey) actions.toggleInspector();
      return;
    }
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
      case 'KeyM':
        ui.showMenu.value = !ui.showMenu.value;
        if (ui.showMenu.value) void this.refreshSaves();
        break;
      case 'KeyV':
        ui.showViews.value = !ui.showViews.value;
        break;
      case 'KeyB':
        ui.showBudget.value = !ui.showBudget.value;
        break;
      case 'Backquote':
        ui.showDev.value = !ui.showDev.value;
        break;
    }
  };

  private onActivity = (): void => {
    this.lastInput = performance.now();
  };

  /** Switches the graphics preset. */
  applyQuality(id: QualityId, remember: boolean): void {
    const q = QUALITY[id];
    this.quality = q;
    ui.quality.value = id;
    if (remember) saveQuality(id);
    // Screenshot runs keep the settings they were tuned with.
    if (this.options.shots) return;
    this.engine.setQuality(q.maxDpr, q.ao);
    this.shadows.setMapSize(q.shadowMap);
    this.chamber?.setAo(q.ao);
    this.shadowDirty = true;
    this.onResize();
  }

  /** How many frames per second the current moment needs. */
  private pickFps(now: number): number {
    if (this.options.shots || !this.ready) return 60;
    const q = this.quality;
    if (!document.hasFocus()) return Math.min(15, q.idleFps);
    const cine = this.cinematic.phase === 'enter' || this.cinematic.phase === 'exit';
    if (cine || now - this.lastInput < 1500 || now - this.lastMove < 600) return q.activeFps;
    // A paused city with nothing moving needs only enough frames for water and trees.
    if (this.sim.state.speed === 0 && !this.cinematic.inside) return Math.min(20, q.idleFps);
    return q.idleFps;
  }

  private onResize = (): void => {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.rig.resize(w / h);
    this.engine.resize();
    this.chamber?.resize(w, h);
  };

  /** Founds the town hall if the city has none (new cities and saves from before it existed). */
  ensureTownHall(): boolean {
    const s = this.sim.state;
    let ok = s.buildings.some((b) => b && b.kind === FacilityKind.TownHall);
    if (!ok) ok = this.sim.apply({ type: 'foundTownHall' }).ok;
    this.doors.attach(townHallOf(s.buildings));
    return ok;
  }

  /** Calls the council on an issue: the walk into the town hall, then the briefing. */
  convene(issueKey: string): boolean {
    this.tools.select('none');
    this.council.convene(issueKey);
    const v = ui.council.value;
    if (!v || v.issue.key !== issueKey) return false;
    if (this.cinematic.phase !== 'off') return true;
    const chamber = this.ensureChamber();
    const seat = (id: keyof typeof MINISTER_BY_ID) => {
      const m = MINISTER_BY_ID[id];
      return { id, name: m.name, role: m.short, color: m.color, looks: m.looks };
    };
    chamber.setCast(
      this.sim.state.cityName,
      { id: 'chief', name: CHIEF_SECRETARY.name, role: CHIEF_SECRETARY.title, color: CHIEF_SECRETARY.color, looks: CHIEF_SECRETARY.looks },
      v.seats.map((x) => seat(x.id)),
    );
    // Compile the chamber's shaders during the approach so the cut inside does not stall.
    void this.engine.renderer.compileAsync(chamber.scene, chamber.camera).catch(() => {});
    const hall = townHallOf(this.sim.state.buildings);
    const p = this.rig.pose;
    this.cinematic.enter(hall ? doorFrame(hall) : null, this.rig.camera, this.lookTmp.set(p.x, this.rig.focusY, p.z));
    return true;
  }

  closeCouncil(): void {
    this.council.close();
    this.cinematic.exit();
  }

  private ensureChamber(): Chamber {
    if (!this.chamber) {
      this.chamber = new Chamber(this.engine.renderer);
      this.chamber.resize(this.canvas.clientWidth, this.canvas.clientHeight);
    }
    return this.chamber;
  }

  private onCinePhase(p: CinePhase): void {
    ui.cinema.value = p === 'off' ? 'off' : p === 'exit' ? 'leaving' : this.cinematic.inside || p === 'inside' ? 'inside' : 'approach';
  }

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    // Skip display refreshes the moment does not need (60 Hz and 120 Hz screens alike).
    this.targetFps = this.pickFps(now);
    if (now - this.lastFrame < 1000 / this.targetFps - 3) return;
    this.lastFrame = now;
    this.step(now);
  };

  /** One frame: advance the sim by whole ticks, then update and draw the view. */
  private step(now: number): void {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const state = this.sim.state;

    const t0 = performance.now();
    this.acc += dt * 1000 * SPEED_FACTOR[state.speed];
    let ticks = 0;
    while (this.acc >= TICK_MS && ticks < MAX_TICKS_PER_FRAME) {
      this.sim.tick();
      this.acc -= TICK_MS;
      ticks++;
    }
    if (ticks === MAX_TICKS_PER_FRAME) this.acc = 0; // fell behind: drop the backlog
    this.simMs = performance.now() - t0;

    // During the walk into the town hall the cinematic drives the camera.
    const cine = this.cinematic?.update(dt, this.rig.camera) ?? false;
    const inside = this.cinematic?.inside ?? false;
    const before = this.rig.pose;
    if (!cine) {
      this.input?.update(dt);
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
      if (moved) this.lastMove = now;
    }
    this.preview?.update(dt, before.dist);
    if (this.overlay) {
      this.overlay.update(dt);
      this.overlayTimer += dt;
      if (this.overlayTimer > 1 && this.overlay.id !== 'none') {
        this.overlayTimer = 0;
        this.overlay.refresh(this.sim);
      }
    }
    const cam = this.rig.camera;
    this.camPos.copy(cam.position);
    this.advanceClock(dt);
    // Traffic follows the clock the player sees: rush hours at 9:00 and 18:00.
    this.sim.traffic.hour = this.simHour();
    this.council?.update(dt);
    // The season's sky and weather. Scripted runs keep the plain sky unless they set one.
    const sky = this.heldSky ?? (this.options.shots ? null : skyAt(this.sim.state.tick, this.sim.state.seed, Math.min(1, this.acc / TICK_MS)));
    this.atmosphere.setSky(sky);
    this.rain ??= new Rain(this.engine.scene);
    this.rain.update(this.lookTmp.set(this.rig.pose.x, this.rig.focusY, this.rig.pose.z), this.rig.pose.dist, cine ? 0 : (sky?.rain ?? 0), 1 - this.atmosphere.night, dt);
    this.atmosphere.update(cam, dt);
    this.roads?.setNight(this.atmosphere.night);
    const viewDist = cine ? this.cinematic.focusDist : this.rig.pose.dist;
    if (this.shadows.update(cam, this.atmosphere.lightDir, cine ? this.cinematic.lookY : this.rig.focusY, viewDist)) this.shadowDirty = true;
    // The sun creeps across the sky: redraw shadows once it has moved a fraction of a degree.
    if (this.shadowDir.angleTo(this.atmosphere.lightDir) > 0.003) {
      this.shadowDir.copy(this.atmosphere.lightDir);
      this.shadowDirty = true;
    }
    // Cars only cast shadows close up, where they can be seen; then the map follows them.
    const carShadows = viewDist < 320 && this.sim.traffic.count > 0;
    if (carShadows !== this.carShadows) {
      this.carShadows = carShadows;
      this.vehicles?.setCastShadow(carShadows);
      this.shadowDirty = true;
    }
    if (carShadows && state.speed > 0) this.shadowDirty = true;
    this.engine.renderer.shadowMap.needsUpdate = this.shadowDirty;
    this.shadowDirty = false;
    this.trees?.updateLod(this.camPos);
    this.roads?.update();
    this.buildings?.update();
    // While paused the cars sit at their last tick position.
    this.vehicles?.update(this.sim.traffic, state.speed === 0 ? 1 : Math.min(1, this.acc / TICK_MS), this.atmosphere.night);
    this.metro?.update(dt * Math.min(state.speed, 2), this.atmosphere.night);
    this.planes ??= new Planes(this.engine.scene);
    this.planes.update(state, state.speed === 0 ? 1 : Math.min(1, this.acc / TICK_MS));
    // People on the pavements, near the camera only. They walk at game speed.
    this.people ??= new Pedestrians(this.engine.scene);
    if (!cine) this.people.update(this.sim, { x: this.rig.pose.x, z: this.rig.pose.z }, this.rig.pose.dist, this.simHour(), sky?.rain ?? 0, dt * SPEED_FACTOR[state.speed]);
    if (inside && this.chamber) {
      const v = ui.council.value;
      const thinking = new Set<string>();
      const silent = new Set<string>();
      if (v) {
        for (const s of v.seats) {
          if (s.state === 'thinking') thinking.add(s.id);
          else if (s.state === 'silent') silent.add(s.id);
        }
        if (v.chief === 'thinking') thinking.add('chief');
      }
      this.chamber.setState({ speaker: v?.speaking?.who ?? null, speechKey: v?.speaking?.key ?? null, thinking, silent });
      this.chamber.setNight(this.atmosphere.night);
      this.chamber.update(dt);
      this.engine.renderer.shadowMap.needsUpdate = true;
      this.chamber.render(dt);
      // Back outside, the city's map has to be drawn again.
      this.shadowDirty = true;
    } else {
      this.engine.render(dt);
    }
    this.frameCount++;

    this.audio.update(dt, { dist: this.rig.pose.dist, population: state.stats.population, night: this.atmosphere.night, paused: state.speed === 0, rain: sky?.rain ?? 0 });
    this.adaptResolution(dt);
    if (!this.options.shots && this.ready) {
      this.autosaveTimer += dt;
      if (this.autosaveTimer > 120) {
        this.autosaveTimer = 0;
        void this.saveTo('autosave');
      }
    }

    this.updateHud(dt);
  }

  private updateHud(dt: number): void {
    const state = this.sim.state;
    const d = dateOf(state.tick);
    if (d.totalDays !== this.lastDay) {
      this.lastDay = d.totalDays;
      ui.dateLabel.value = `${MONTH_NAMES[d.month]}, Year ${d.year - START_YEAR + 1}`;
      ui.season.value = SEASONS[d.season]!.id;
    }
    this.hudTimer += dt;
    if (this.hudTimer >= 0.25) {
      this.hudTimer = 0;
      const st = state.stats;
      ui.funds.value = Math.floor(state.funds);
      ui.population.value = st.population;
      ui.demand.value = [st.demand[1], st.demand[2], st.demand[3]];
      ui.budget.value = projectBudget(state.buildings, state.roads, state.tax, state.loans, st, emptyReport(), state.policies, state.metro);
      ui.tax.value = [state.tax[1], state.tax[2], state.tax[3]];
      ui.loans.value = state.loans.slice();
      ui.power.value = [st.powerSupply, st.powerDemand];
      ui.water.value = [st.waterSupply, st.waterDemand];
      ui.sandbox.value = state.sandbox;
      ui.happiness.value = st.happiness;
      const hr = this.simHour();
      ui.clock.value = `${String(Math.floor(hr)).padStart(2, '0')}:${String(Math.floor((hr % 1) * 60)).padStart(2, '0')}`;
      ui.isNight.value = this.atmosphere.night > 0.5;
      const w = this.heldWeather ?? this.sim.weather;
      const season = SEASONS.find((x) => x.id === w.season)!;
      ui.weather.value = { season: w.season, name: season.name, english: season.english, temperature: w.temperature, rain: w.rain, mist: w.mist, effect: SEASON_SPECS[w.season].effect };
      ui.alerts.value = this.alerts();
      ui.inspect.value = this.inspectId >= 0 ? this.describe(this.inspectId) : null;
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
          `buildings ${this.buildings?.buildingCount ?? 0}  cars ${this.sim.traffic.count}\n` +
          `shadow texel ${this.shadows.texel.toFixed(2)} m  dpr ${this.engine.pixelRatio.toFixed(2)}`;
      }
    }
  }

  /** Installs a whole new game state (new city or a loaded one). */
  loadState(state: GameState): void {
    this.sim.replaceState(state);
  }

  /** Points every renderer at the new state and rebuilds what it draws. */
  private onStateReplaced(): void {
    const s = this.sim.state;
    this.terrain.setHeights(s.heights, s.seed);
    this.water.setHeights(s.heights, s.seed);
    this.trees.setSource(s.trees, s.heights);
    this.roads.setSource(s);
    this.buildings.setSource(s.buildings);
    this.zones.setSource(s.zone);
    this.tools.select('none');
    this.inspectId = -1;
    this.lastDay = -1;
    this.hudTimer = 1;
    ui.cityName.value = s.cityName;
    ui.speed.value = s.speed;
    if (this.overlay.id !== 'none') this.overlay.refresh(this.sim);
    if (!this.options.shots) this.ensureTownHall();
    else this.doors.attach(townHallOf(s.buildings));
    this.metro.rebuild(s);
  }

  private async saveTo(slot: string): Promise<boolean> {
    try {
      const copy = cloneState(this.sim.state);
      await saves.put(metaOf(slot, copy, Date.now()), copy);
      await this.refreshSaves();
      return true;
    } catch (err) {
      console.warn('[save]', err);
      return false;
    }
  }

  private async loadFrom(slot: string): Promise<void> {
    try {
      const raw = await saves.get(slot);
      const state = raw ? validateState(raw) : 'Nothing is saved in that slot';
      if (typeof state === 'string') {
        ui.menuNote.value = state;
        this.audio.play('error');
        return;
      }
      this.loadState(state);
      ui.menuNote.value = 'City loaded.';
    } catch (err) {
      console.warn('[load]', err);
      ui.menuNote.value = 'Could not load: storage is unavailable.';
    }
  }

  private async refreshSaves(): Promise<void> {
    try {
      ui.saves.value = await saves.list();
    } catch {
      ui.saves.value = [];
    }
  }

  /** Lowers the render resolution when frames run long and raises it again when there is headroom. */
  private adaptResolution(dt: number): void {
    if (this.options.shots) return;
    const e = this.engine;
    const cap = e.maxPixelRatio;
    this.resCooldown = Math.max(0, this.resCooldown - dt);
    // Slow means late against the frame rate the loop is aiming for.
    if (dt > 1.25 / this.targetFps + 0.002) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 2);
    if (this.targetFps >= 60 && this.frameMs < 17.5) this.fastSeconds += dt;
    else this.fastSeconds = 0;
    if (this.slowFrames > 45 && e.pixelRatio > 0.75) {
      e.pixelRatio = Math.max(0.75, e.pixelRatio - 0.25);
      e.resize();
      this.slowFrames = 0;
      this.fastSeconds = 0;
      this.resCooldown = 30;
    } else if (this.fastSeconds > 8 && this.resCooldown === 0 && e.pixelRatio < cap) {
      e.pixelRatio = Math.min(cap, e.pixelRatio + 0.25);
      e.resize();
      this.fastSeconds = 0;
    }
  }

  /**
   * The time of day in the city, from the simulation's own clock: the one the calendar,
   * the budget and the rush hour run on. It moves smoothly between ticks and stops when
   * the game is paused. A scripted run can hold it at a fixed hour.
   */
  simHour(): number {
    return this.heldHour ?? dateOf(this.sim.state.tick, Math.min(1, this.acc / TICK_MS)).hour;
  }

  /**
   * Moves the sky. In auto mode it shows the city's real time of day. The Day and Night
   * modes pin the light at 14:30 or 22:00 for players who want to build in daylight; the
   * clock and the traffic keep their real time either way. Changes glide, so a jump (a
   * loaded city, a mode switch) sweeps the sun across instead of snapping.
   */
  private advanceClock(dt: number): void {
    const atmo = this.atmosphere;
    const mode = ui.timeMode.value;
    if (this.clockHeld) return;
    const target = mode === 'auto' ? this.simHour() : mode === 'day' ? 14.5 : 22;
    let d = target - atmo.hour;
    if (d > 12) d -= 24;
    if (d < -12) d += 24;
    const step = dt * 6;
    atmo.hour = Math.abs(d) <= step ? target : (atmo.hour + Math.sign(d) * step + 24) % 24;
  }

  /** Shows a given sky and weather instead of the calendar's (for screenshots), or null to follow the calendar. */
  setSky(sky: Sky | null, weather: Weather | null = null): void {
    this.heldSky = sky;
    this.heldWeather = sky ? weather : null;
  }

  /** Jumps to a time of day and holds the clock there (used by the screenshot runs). */
  setTime(hour: number): void {
    this.clockHeld = true;
    this.heldHour = ((hour % 24) + 24) % 24;
    this.atmosphere.setHour(hour);
  }

  /** The inspect panel's contents for one building, or null if it no longer exists. */
  private describe(id: number): import('../ui/store').InspectData | null {
    const s = this.sim.state;
    const b = s.buildings[id];
    if (!b) {
      this.inspectId = -1;
      return null;
    }
    const f = this.sim.fields;
    const k = (b.y + (b.h >> 1)) * MAP + b.x + (b.w >> 1);
    const pct = (v: number): string => `${Math.round(v * 100)}%`;
    const rows: import('../ui/store').InspectData['rows'] = [];
    let title: string;
    let subtitle: string;
    if (b.kind !== 0) {
      const spec = FACILITIES[b.kind]!;
      title = spec.name;
      subtitle = b.progress < 1 ? 'Under construction' : spec.blurb;
      if (spec.power > 0) rows.push(['Output', `${spec.power} MW`]);
      if (spec.water > 0) rows.push(['Output', `${spec.water.toLocaleString('en-US')} water`]);
      if (spec.service !== Service.None) rows.push(['Reach', `${spec.radius * CELL} m`]);
      rows.push(['Upkeep', `$${spec.upkeep} / hour`]);
      if (b.kind === FacilityKind.BusStop && b.progress >= 1) {
        const line = this.sim.busLines.findIndex((l) => l.stops.includes(b.id));
        const l = this.sim.busLines[line];
        rows.push(l ? ['Bus line', `Line ${line + 1}: ${l.stops.length} stops, ${l.buses} bus${l.buses > 1 ? 'es' : ''}`, 'good'] : ['Bus line', 'Not served: place another stop on connected roads', 'bad']);
      }
      if (b.kind === FacilityKind.Airport && b.progress >= 1) {
        const flights = Planes.flightsPerHour(this.sim.state.stats.population);
        rows.push(['Flights', `${flights} an hour`], ['Earns', `$${projectBudget(this.sim.state.buildings, this.sim.state.roads, this.sim.state.tax, this.sim.state.loans, this.sim.state.stats, emptyReport(), this.sim.state.policies, this.sim.state.metro).airport.toLocaleString('en-US')} / hour`, 'good']);
      }
    } else {
      const t = zoneType(b.zone);
      const cap = capacityOf(b);
      title = `${ZONE_NAMES[t]} building`;
      subtitle = b.progress < 1 ? `Under construction (stage ${stageOf(b.progress) + 1} of 4)` : `${DENSITY_NAMES[zoneDensity(b.zone)]} density, level ${b.level}`;
      rows.push([t === ZoneType.Residential ? 'Residents' : 'Workers', `${b.pop} / ${cap}`]);
      if (b.progress >= 1) {
        rows.push(['Power', b.flags & POWERED ? 'Connected' : 'No power', b.flags & POWERED ? 'good' : 'bad']);
        rows.push(['Water', b.flags & WATERED ? 'Connected' : 'No water', b.flags & WATERED ? 'good' : 'bad']);
      }
      if (t === ZoneType.Residential && b.progress >= 1) rows.push(['Happiness', pct(f.happiness[k]!), f.happiness[k]! >= 0.5 ? 'good' : 'bad']);
    }
    rows.push(['Land value', pct(f.landValue[k]!)]);
    rows.push(['Pollution', pct(f.pollution[k]!), f.pollution[k]! > 0.3 ? 'bad' : undefined]);
    rows.push(['Crime', pct(Math.min(1, f.crime[k]! * 2.2)), f.crime[k]! > 0.15 ? 'bad' : undefined]);
    return { title, subtitle, rows };
  }

  /** Short messages about what is holding the city back, most important first. */
  private alerts(): string[] {
    return cityAlerts(this.sim);
  }

  /** The tool in the player's hand, in words, for the assistant. */
  private toolLabel(): string {
    const t = ui.tool.value;
    if (t === 'road') return ui.roadType.value === 1 ? 'Avenue tool' : 'Street tool';
    if (t === 'zone') return ui.zoneType.value === 0 ? 'De-zone tool' : `Zone tool (${['', 'Homes', 'Shops', 'Industry'][ui.zoneType.value]}, density ${ui.zoneDensity.value})`;
    if (t === 'place') return `Placing a ${FACILITIES[ui.facility.value]?.name ?? 'facility'}`;
    if (t === 'bulldoze') return 'Bulldozer';
    return 'none';
  }

  /** Numbers for the dev overlay and automated performance checks. */
  stats(): { fps: number; frameMs: number; drawCalls: number; triangles: number; simMs: number; gpu: string; trees: number; cars: number } {
    const s = this.engine.stats;
    return {
      fps: this.fps,
      frameMs: this.frameMs,
      drawCalls: s.drawCalls,
      triangles: s.triangles,
      simMs: this.simMs,
      gpu: this.engine.gpuName,
      trees: this.trees?.count ?? 0,
      cars: this.sim.traffic.count,
    };
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
