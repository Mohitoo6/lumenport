import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  HalfFloatType,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Scene,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type Material,
  type BufferGeometry,
  type WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { patchHalfResTarget } from '../engine';
import type { Looks } from '../../game/council/ministries';
import { Actor, type ActorMode } from './actor';
import { buildHuman } from './humanoid';
import { carpetTexture, emblemTexture, namePlateTexture, panelTexture, woodTexture } from './textures';

/**
 * The council chamber inside the town hall: a panelled room with tall windows, an oval
 * table, the Chief Secretary at its head, ministers down both sides and the mayor's empty
 * chair at the near end, where the camera starts. It has its own scene, camera and
 * post-processing and is drawn instead of the city while the council sits.
 */

export interface CastMember {
  id: string;
  name: string;
  role: string;
  color: string;
  looks: Looks;
}

export interface ChamberState {
  /** Who is speaking now ('chief' for the Chief Secretary), or null. */
  speaker: string | null;
  /** A key that changes with every new speech, so each one gets a fresh shot. */
  speechKey: string | null;
  thinking: ReadonlySet<string>;
  silent: ReadonlySet<string>;
}

const ROOM_W = 12;
const ROOM_D = 16;
const ROOM_H = 5.6;
const TABLE_HALF_W = 1.2;
const TABLE_STRAIGHT = 1.8;
const TABLE_H = 0.76;
const SIDE_X = TABLE_HALF_W + 0.3;
const SIDE_Z = [-1.35, 0.05, 1.45];
const HEAD_Z = -(TABLE_STRAIGHT + TABLE_HALF_W) - 0.3;
const MAYOR_Z = TABLE_STRAIGHT + TABLE_HALF_W + 0.36;

function std(color: Color | string | number, roughness: number, metalness = 0, extra: Partial<MeshStandardMaterial> = {}): MeshStandardMaterial {
  return Object.assign(new MeshStandardMaterial({ color: new Color(color), roughness, metalness }), extra);
}

function add(parent: Group, geo: BufferGeometry, mat: Material | Material[], x: number, y: number, z: number, cast = true): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function racetrack(halfW: number, straight: number): Shape {
  const s = new Shape();
  s.moveTo(-halfW, -straight);
  s.lineTo(-halfW, straight);
  s.absarc(0, straight, halfW, Math.PI, 0, true);
  s.lineTo(halfW, -straight);
  s.absarc(0, -straight, halfW, 0, Math.PI, true);
  return s;
}

function skyTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#9cc4ee');
  grad.addColorStop(0.65, '#dcebf6');
  grad.addColorStop(0.66, '#9fb49a');
  grad.addColorStop(1, '#7d9476');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Share of the screen height by which the chamber's picture is raised to clear the UI below it. */
const LENS_LIFT = 0.09;

interface SeatSlot {
  pos: Vector3;
  /** Facing direction (toward the table). */
  yaw: number;
}

function slotFor(index: number): SeatSlot {
  // Alternate sides, starting nearest the chair.
  const side = index % 2 === 0 ? -1 : 1;
  const row = Math.floor(index / 2);
  return { pos: new Vector3(side * SIDE_X, 0, SIDE_Z[row] ?? 0), yaw: side < 0 ? Math.PI / 2 : -Math.PI / 2 };
}

interface Seated {
  actor: Actor;
  mic: MeshStandardMaterial;
  head: Vector3;
  facing: Vector3;
  slot: SeatSlot;
}

export class Chamber {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(34, 1, 0.1, 80);
  private readonly composer: EffectComposer;
  private readonly ao: N8AOPostPass;
  private readonly bloom: BloomEffect;
  private readonly room = new Group();
  private readonly cast = new Group();
  private readonly people = new Map<string, Seated>();
  private readonly rigCache = new Map<string, Actor>();
  private emblemMat: MeshBasicMaterial | null = null;
  private emblemCity = '';
  private readonly windowMat = new MeshBasicMaterial({ map: skyTexture() });
  private readonly sun: DirectionalLight;
  private readonly lamps: PointLight[] = [];
  private readonly bulbMat = std('#fff3d8', 0.3, 0, { emissive: new Color(1, 0.8, 0.55), emissiveIntensity: 6 });
  private readonly woodDark: MeshStandardMaterial;
  private readonly brass = std('#c9a050', 0.32, 1);

  // Camera shot: eased toward the goal every frame.
  private readonly camPos = new Vector3(0, 1.7, 7.6);
  private readonly camLook = new Vector3(0, 1.1, 0);
  private readonly goalPos = new Vector3();
  private readonly goalLook = new Vector3();
  private shotKey: string | null = null;
  private shotCount = 0;
  private shotSide = 1;
  private shotWide = false;
  private time = 0;
  private readonly tmp = new Vector3();
  private state: ChamberState = { speaker: null, speechKey: null, thinking: new Set(), silent: new Set() };

  constructor(renderer: WebGLRenderer) {
    const pmrem = new PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
    this.scene.background = new Color('#14100c');
    this.woodDark = std('#ffffff', 0.38, 0, { map: woodTexture(0) });

    this.sun = new DirectionalLight(new Color(1, 0.93, 0.82), 2.4);
    this.sun.position.set(9, 7.5, 2.5);
    this.sun.target.position.set(0, 0, -0.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -7;
    sc.right = 7;
    sc.top = 7;
    sc.bottom = -7;
    sc.near = 1;
    sc.far = 30;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(new AmbientLight(new Color(1, 0.9, 0.8), 0.18));

    this.buildRoom();
    this.scene.add(this.room, this.cast);

    this.composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType });
    this.composer.autoRenderToScreen = true;
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const ao = new N8AOPostPass(this.scene, this.camera, 512, 512);
    this.ao = ao;
    patchHalfResTarget(ao);
    const c = ao.configuration;
    c.aoRadius = 0.55;
    c.distanceFalloff = 0.5;
    c.intensity = 2.4;
    c.aoSamples = 12;
    c.denoiseSamples = 6;
    c.denoiseRadius = 8;
    c.halfRes = true;
    c.depthAwareUpsampling = true;
    c.gammaCorrection = false;
    c.color.setRGB(0.05, 0.03, 0.02);
    this.composer.addPass(ao);
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.6, luminanceSmoothing: 0.5, intensity: 0.7, radius: 0.7, levels: 6 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.5 });
    this.composer.addPass(new EffectPass(this.camera, this.bloom, tone, vignette));
    this.composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
  }

  // ---------------------------------------------------------------- room

  private buildRoom(): void {
    const g = this.room;
    const floorTex = woodTexture(1, 10);
    floorTex.repeat.set(3, 3);
    const floor = add(g, new PlaneGeometry(ROOM_W, ROOM_D), std('#ffffff', 0.32, 0, { map: floorTex }), 0, 0, 0, false);
    floor.rotation.x = -Math.PI / 2;
    const carpet = add(g, new PlaneGeometry(6.4, 9.6), std('#ffffff', 0.92, 0, { map: carpetTexture() }), 0, 0.006, -0.1, false);
    carpet.rotation.x = -Math.PI / 2;

    const plaster = std('#e9e0cf', 0.88);
    const ceilingMat = std('#f2ece0', 0.9);
    const trim = std('#f4efe4', 0.6);
    const panel = panelTexture();
    const wainscotH = 1.25;

    // Walls: plaster above a panelled wainscot, with a cornice.
    const wall = (w: number, x: number, z: number, ry: number): Group => {
      const wg = new Group();
      wg.position.set(x, 0, z);
      wg.rotation.y = ry;
      const upper = add(wg, new PlaneGeometry(w, ROOM_H - wainscotH), plaster, 0, wainscotH + (ROOM_H - wainscotH) / 2, 0, false);
      upper.receiveShadow = true;
      const t = panel.clone();
      t.repeat.set(w / 2.2, 1);
      t.needsUpdate = true;
      add(wg, new BoxGeometry(w, wainscotH, 0.06), std('#ffffff', 0.42, 0, { map: t }), 0, wainscotH / 2, 0.03, false);
      add(wg, new BoxGeometry(w, 0.07, 0.1), this.woodDark, 0, wainscotH, 0.05, false);
      add(wg, new BoxGeometry(w, 0.16, 0.08), this.woodDark, 0, 0.08, 0.06, false);
      add(wg, new BoxGeometry(w, 0.22, 0.24), trim, 0, ROOM_H - 0.11, 0.12, false);
      g.add(wg);
      return wg;
    };
    wall(ROOM_W, 0, -ROOM_D / 2, 0);
    wall(ROOM_W, 0, ROOM_D / 2, Math.PI);
    const left = wall(ROOM_D, -ROOM_W / 2, 0, Math.PI / 2);
    const right = wall(ROOM_D, ROOM_W / 2, 0, -Math.PI / 2);

    // Tall windows on both long walls; light pours in from the right.
    for (const wg of [left, right]) {
      for (const z of [-4.6, 0, 4.6]) {
        const win = new Group();
        win.position.set(z, 0, 0.02);
        wg.add(win);
        const glass = add(win, new PlaneGeometry(1.7, 3.0), this.windowMat, 0, 1.55 + 1.5, 0.01, false);
        glass.castShadow = false;
        // Frame and mullions.
        add(win, new BoxGeometry(1.95, 0.14, 0.16), trim, 0, 1.5, 0.06, false);
        add(win, new BoxGeometry(1.95, 0.14, 0.16), trim, 0, 4.62, 0.06, false);
        add(win, new BoxGeometry(0.12, 3.2, 0.16), trim, -0.92, 3.05, 0.06, false);
        add(win, new BoxGeometry(0.12, 3.2, 0.16), trim, 0.92, 3.05, 0.06, false);
        add(win, new BoxGeometry(0.05, 3.0, 0.06), trim, 0, 3.05, 0.04, false);
        for (const y of [2.3, 3.1, 3.9]) add(win, new BoxGeometry(1.7, 0.04, 0.06), trim, 0, y, 0.04, false);
        // Curtains either side.
        const drape = std(new Color('#5b1a1e'), 0.85);
        for (const s of [-1, 1]) {
          const c = add(win, new CylinderGeometry(0.16, 0.22, 3.6, 12, 1, true), drape, s * 1.2, 2.95, 0.22);
          c.scale.z = 0.45;
        }
        add(win, new BoxGeometry(2.8, 0.22, 0.22), this.woodDark, 0, 4.86, 0.2);
      }
    }

    // Ceiling with coffers.
    const ceiling = add(g, new PlaneGeometry(ROOM_W, ROOM_D), ceilingMat, 0, ROOM_H, 0, false);
    ceiling.rotation.x = Math.PI / 2;
    for (let x = -ROOM_W / 2 + 2; x < ROOM_W / 2; x += 2) add(g, new BoxGeometry(0.18, 0.24, ROOM_D), trim, x, ROOM_H - 0.12, 0, false);
    for (let z = -ROOM_D / 2 + 2; z < ROOM_D / 2; z += 2) add(g, new BoxGeometry(ROOM_W, 0.24, 0.18), trim, 0, ROOM_H - 0.12, z, false);

    // Two chandeliers over the table.
    for (const z of [-1.5, 1.5]) {
      const ch = new Group();
      ch.position.set(0, ROOM_H - 1.7, z);
      g.add(ch);
      add(ch, new CylinderGeometry(0.012, 0.012, 1.5, 6), this.brass, 0, 0.95, 0, false);
      const ring = add(ch, new TorusGeometry(0.55, 0.03, 8, 40), this.brass, 0, 0, 0, false);
      ring.rotation.x = Math.PI / 2;
      add(ch, new SphereGeometry(0.09, 16, 12), this.brass, 0, 0, 0, false);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        add(ch, new CylinderGeometry(0.025, 0.03, 0.12, 8), this.brass, Math.cos(a) * 0.55, 0.06, Math.sin(a) * 0.55, false);
        add(ch, new SphereGeometry(0.045, 12, 10), this.bulbMat, Math.cos(a) * 0.55, 0.15, Math.sin(a) * 0.55, false);
      }
      const lamp = new PointLight(new Color(1, 0.78, 0.52), 9, 14, 1.6);
      lamp.position.set(0, 0.1, 0);
      ch.add(lamp);
      this.lamps.push(lamp);
    }

    // The table: polished walnut with a leather inlay, on two pedestals.
    const top = new ExtrudeGeometry(racetrack(TABLE_HALF_W, TABLE_STRAIGHT), { depth: 0.07, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.025, bevelSegments: 3, curveSegments: 40 });
    top.rotateX(Math.PI / 2);
    const tableWood = std('#ffffff', 0.22, 0, { map: woodTexture(0) });
    tableWood.map!.repeat.set(0.4, 0.4);
    add(g, top, tableWood, 0, TABLE_H, 0);
    const inlay = new ExtrudeGeometry(racetrack(TABLE_HALF_W - 0.42, TABLE_STRAIGHT), { depth: 0.004, bevelEnabled: false, curveSegments: 40 });
    inlay.rotateX(Math.PI / 2);
    add(g, inlay, std('#1f3b2c', 0.55), 0, TABLE_H + 0.006, 0, false);
    for (const z of [-1.4, 1.4]) {
      add(g, new BoxGeometry(1.1, TABLE_H - 0.08, 0.5), this.woodDark, 0, (TABLE_H - 0.08) / 2, z);
      add(g, new BoxGeometry(1.4, 0.06, 0.8), this.woodDark, 0, 0.03, z);
    }
    // A bowl of flowers in the middle.
    add(g, new CylinderGeometry(0.16, 0.1, 0.12, 24), this.brass, 0, TABLE_H + 0.07, 0);
    const petals = [std('#f3d36b', 0.6), std('#e8eef0', 0.6), std('#d65a4a', 0.6)];
    for (let k = 0; k < 16; k++) {
      const a = k * 2.4;
      const r = 0.05 + (k % 4) * 0.035;
      add(g, new SphereGeometry(0.045, 10, 8), petals[k % 3]!, Math.cos(a) * r, TABLE_H + 0.16 + (k % 3) * 0.03, Math.sin(a) * r, false);
    }

    // Behind the chair: the city emblem, flags and a sideboard.
    const emblem = add(g, new PlaneGeometry(2.0, 2.0), new MeshBasicMaterial({ transparent: true, color: new Color(1.4, 1.4, 1.4) }), 0, 3.35, -ROOM_D / 2 + 0.05, false);
    emblem.castShadow = false;
    this.emblemMat = emblem.material as MeshBasicMaterial;
    add(g, new BoxGeometry(3.6, 0.9, 0.55), this.woodDark, 0, 0.45, -ROOM_D / 2 + 0.35);
    add(g, new BoxGeometry(3.7, 0.04, 0.6), tableWood, 0, 0.92, -ROOM_D / 2 + 0.35);
    // Banners either side of the emblem, hanging from brass rods.
    for (const [x, col] of [
      [-2.7, '#b4452a'],
      [2.7, '#2c5590'],
    ] as const) {
      const banner = new PlaneGeometry(1.1, 2.6, 8, 1);
      const pos = banner.attributes.position!;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 6) * 0.04);
      banner.computeVertexNormals();
      const cloth = std(col, 0.85, 0, { side: DoubleSide });
      add(g, banner, cloth, x, 3.15, -ROOM_D / 2 + 0.16);
      const fringe = add(g, new BoxGeometry(1.12, 0.07, 0.03), std('#d8b45a', 0.5, 0.6), x, 1.82, -ROOM_D / 2 + 0.17, false);
      fringe.castShadow = false;
      add(g, new CylinderGeometry(0.022, 0.022, 1.4, 8), this.brass, x, 4.48, -ROOM_D / 2 + 0.2).rotation.z = Math.PI / 2;
      for (const s of [-1, 1]) add(g, new SphereGeometry(0.04, 10, 8), this.brass, x + s * 0.7, 4.48, -ROOM_D / 2 + 0.2, false);
    }

    // Potted plants in the corners.
    const pot = std('#3a3f45', 0.5, 0.2);
    const leaf = std('#3f6b35', 0.7);
    for (const [x, z] of [
      [-5.2, -7.2],
      [5.2, -7.2],
      [-5.2, 7.2],
      [5.2, 7.2],
    ] as const) {
      add(g, new CylinderGeometry(0.32, 0.24, 0.6, 18), pot, x, 0.3, z);
      for (let k = 0; k < 9; k++) {
        const a = k * 2.2;
        add(g, new SphereGeometry(0.26 - (k % 3) * 0.04, 10, 8), leaf, x + Math.cos(a) * 0.18, 0.85 + k * 0.11, z + Math.sin(a) * 0.18);
      }
    }

    // Portraits of past mayors along the side walls, between the windows.
    const frame = std('#9a7a3a', 0.35, 0.8);
    for (const wg of [left, right]) {
      for (const z of [-2.3, 2.3]) {
        add(wg, new BoxGeometry(1.0, 1.25, 0.06), frame, z, 3.0, 0.05, false);
        add(wg, new PlaneGeometry(0.84, 1.08), std(new Color().setHSL(0.08 + z * 0.01, 0.3, 0.22), 0.8), z, 3.0, 0.085, false);
      }
    }

    // The far end: the doors the mayor came in by, standing open.
    const doorFrame = std('#2a160c', 0.4);
    add(g, new BoxGeometry(2.6, 3.4, 0.2), new MeshBasicMaterial({ color: new Color(0.9, 0.75, 0.55) }), 0, 1.7, ROOM_D / 2 - 0.02, false);
    add(g, new BoxGeometry(3.0, 0.25, 0.3), doorFrame, 0, 3.5, ROOM_D / 2 - 0.1);
    for (const s of [-1, 1]) {
      add(g, new BoxGeometry(0.2, 3.4, 0.3), doorFrame, s * 1.4, 1.7, ROOM_D / 2 - 0.1);
      const leafG = new Group();
      leafG.position.set(s * 1.3, 0, ROOM_D / 2 - 0.15);
      leafG.rotation.y = s * 1.6;
      add(leafG, new BoxGeometry(1.3, 3.3, 0.08), doorFrame, -s * 0.65, 1.65, 0);
      g.add(leafG);
    }

    // The mayor's chair at the near end, empty, with a name plate.
    const mayor = this.chair('#4a1c1c', true);
    mayor.position.set(0, 0, MAYOR_Z);
    mayor.rotation.y = Math.PI;
    g.add(mayor);
    this.deskSet(g, new Vector3(0, 0, MAYOR_Z), Math.PI, 'The Mayor', 'You', '#e2b14a');
  }

  private chair(leather: string, high: boolean): Group {
    const c = new Group();
    const mat = std(leather, 0.42, 0, { sheen: 0 } as Partial<MeshStandardMaterial>);
    const metal = std('#1d1f22', 0.3, 0.9);
    add(c, new RoundedBoxGeometry(0.56, 0.1, 0.52, 3, 0.04), mat, 0, 0.44, 0.02);
    const back = add(c, new RoundedBoxGeometry(0.56, high ? 0.95 : 0.75, 0.1, 3, 0.04), mat, 0, high ? 0.98 : 0.88, -0.25);
    back.rotation.x = -0.1;
    for (const s of [-1, 1]) {
      add(c, new RoundedBoxGeometry(0.07, 0.06, 0.4, 2, 0.02), mat, s * 0.3, 0.66, 0.0);
      add(c, new BoxGeometry(0.03, 0.2, 0.03), metal, s * 0.3, 0.55, -0.1);
    }
    add(c, new CylinderGeometry(0.03, 0.03, 0.34, 10), metal, 0, 0.22, 0);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const leg = add(c, new BoxGeometry(0.04, 0.03, 0.3), metal, Math.sin(a) * 0.15, 0.04, Math.cos(a) * 0.15);
      leg.rotation.y = a;
    }
    return c;
  }

  /** Name plate, microphone, papers and a glass in front of a seat. Returns the mic's LED material. */
  private deskSet(parent: Group, seat: Vector3, yaw: number, name: string, role: string, color: string): MeshStandardMaterial {
    const set = new Group();
    set.position.copy(seat);
    set.rotation.y = yaw;
    parent.add(set);
    const y = TABLE_H + 0.085;
    // Name plate faces away from the seat, toward the table.
    const plate = new Group();
    plate.position.set(0, y + 0.045, 0.78);
    set.add(plate);
    const plateTex = namePlateTexture(name, role, color);
    const face = std('#ffffff', 0.4, 0, { map: plateTex });
    const plain = std('#2a2622', 0.4, 0.3);
    const p = add(plate, new BoxGeometry(0.34, 0.085, 0.012), [plain, plain, plain, plain, face, plain], 0, 0, 0, false);
    p.rotation.x = -0.35;
    // Microphone.
    const metal = std('#25272b', 0.3, 0.8);
    add(set, new CylinderGeometry(0.045, 0.055, 0.02, 16), metal, 0.16, y + 0.01, 0.62, false);
    const neck = add(set, new CylinderGeometry(0.006, 0.006, 0.3, 6), metal, 0.16, y + 0.14, 0.57, false);
    neck.rotation.x = -0.45;
    add(set, new CylinderGeometry(0.014, 0.012, 0.06, 10), metal, 0.16, y + 0.27, 0.5, false).rotation.x = -1.1;
    const led = std('#401010', 0.4, 0, { emissive: new Color(1, 0.12, 0.08), emissiveIntensity: 0 });
    const ring = add(set, new TorusGeometry(0.016, 0.004, 6, 16), led, 0.16, y + 0.022, 0.62, false);
    ring.rotation.x = Math.PI / 2;
    // Papers and a glass of water.
    const paper = add(set, new BoxGeometry(0.21, 0.004, 0.29), std('#f4f1ea', 0.8), -0.08, y - 0.005, 0.5, false);
    paper.rotation.y = 0.12;
    add(set, new BoxGeometry(0.24, 0.006, 0.32), std(color, 0.6), -0.1, y - 0.01, 0.52, false).rotation.y = 0.05;
    add(set, new CylinderGeometry(0.032, 0.028, 0.11, 16), std('#cfe3ea', 0.05, 0, { transparent: true, opacity: 0.35 }), -0.32, y + 0.05, 0.6, false);
    return led;
  }

  // ---------------------------------------------------------------- cast

  /** Seats the Chief Secretary and the ministers attending this meeting. */
  setCast(city: string, chief: CastMember, ministers: CastMember[]): void {
    if (this.emblemCity !== city && this.emblemMat) {
      this.emblemMat.map?.dispose();
      this.emblemMat.map = emblemTexture(city);
      this.emblemMat.needsUpdate = true;
      this.emblemCity = city;
    }
    // Clear the previous meeting's seats. People are cached and reused; chairs and desk
    // sets are rebuilt, so free their GPU resources.
    const actors = new Set([...this.rigCache.values()].map((a) => a.root));
    for (const child of [...this.cast.children]) {
      if (!actors.has(child)) {
        child.traverse((o) => {
          if (o instanceof Mesh) {
            o.geometry.dispose();
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
              (m as MeshStandardMaterial).map?.dispose();
              m.dispose();
            }
          }
        });
      }
    }
    this.cast.clear();
    this.people.clear();
    this.place(chief, { pos: new Vector3(0, 0, HEAD_Z), yaw: 0 }, true, 0);
    ministers.slice(0, 6).forEach((m, i) => this.place(m, slotFor(i), false, i + 1));
    this.state = { speaker: null, speechKey: null, thinking: new Set(), silent: new Set() };
    this.shotKey = null;
    this.camPos.set(0, 1.7, ROOM_D / 2 - 0.6);
    this.camLook.set(0, 1.15, 0);
    this.shotWide = false;
    this.overview(0);
  }

  private place(m: CastMember, slot: SeatSlot, high: boolean, index: number): void {
    const chair = this.chair(high ? '#3d1414' : '#4b2a1a', high);
    chair.position.copy(slot.pos);
    chair.rotation.y = slot.yaw;
    // Seated people sit slightly back in the chair.
    this.cast.add(chair);
    let actor = this.rigCache.get(m.id);
    if (!actor) {
      actor = new Actor(buildHuman(m.looks, m.color), 17 + index * 131 + m.id.length * 7);
      this.rigCache.set(m.id, actor);
    }
    actor.root.position.copy(slot.pos);
    actor.root.rotation.set(0, slot.yaw, 0);
    actor.mode = 'listen';
    this.cast.add(actor.root);
    const led = this.deskSet(this.cast, slot.pos, slot.yaw, m.name, m.role, m.color);
    const facing = new Vector3(Math.sin(slot.yaw), 0, Math.cos(slot.yaw));
    const head = slot.pos.clone().setY(Actor.HEAD_Y);
    this.people.set(m.id, { actor, mic: led, head, facing, slot });
  }

  // ---------------------------------------------------------------- per frame

  setState(s: ChamberState): void {
    this.state = s;
  }

  setNight(night: number): void {
    const day = 1 - night;
    this.windowMat.color.setRGB(0.12 + 2.2 * day, 0.14 + 2.2 * day, 0.25 + 2.2 * day);
    this.sun.intensity = 2.4 * day;
    for (const l of this.lamps) l.intensity = 9 + 16 * night;
    this.scene.environmentIntensity = 0.3 + 0.3 * day;
  }

  /** Overview shot from behind the mayor's chair. */
  private overview(t: number): void {
    const a = Math.sin(t * 0.07) * 0.35;
    this.goalPos.set(Math.sin(a) * 5.6, 2.55, MAYOR_Z + 2.6 + Math.cos(a) * 0.5);
    this.goalLook.set(0, 0.95, -0.9);
  }

  private speakerShot(p: Seated): void {
    const side = this.shotSide;
    const right = this.tmp.set(p.facing.z, 0, -p.facing.x).multiplyScalar(side);
    if (this.shotWide) {
      this.goalPos.copy(p.head).addScaledVector(p.facing, 3.9).addScaledVector(right, 1.3);
      this.goalPos.y = 2.0;
      this.goalLook.copy(p.head).addScaledVector(p.facing, 0.2);
      this.goalLook.y = 1.05;
    } else {
      this.goalPos.copy(p.head).addScaledVector(p.facing, 2.9).addScaledVector(right, 0.9);
      this.goalPos.y = p.head.y + 0.3;
      this.goalLook.copy(p.head).addScaledVector(p.facing, 0.25);
      this.goalLook.y -= 0.22;
    }
  }

  update(dt: number): void {
    this.time += dt;
    const s = this.state;
    const speaker = s.speaker ? this.people.get(s.speaker) : undefined;
    if (s.speechKey !== this.shotKey) {
      this.shotKey = s.speechKey;
      this.shotCount++;
      this.shotSide = this.shotCount % 2 ? 1 : -1;
      this.shotWide = this.shotCount % 3 === 0;
    }
    if (speaker) this.speakerShot(speaker);
    else this.overview(this.time);

    const mayorHead = this.tmp.set(0, 1.25, MAYOR_Z);
    const lookPoint = speaker ? speaker.head : null;
    for (const [id, p] of this.people) {
      const a = p.actor;
      let mode: ActorMode = 'listen';
      if (id === s.speaker) mode = 'speak';
      else if (s.thinking.has(id)) mode = 'think';
      else if (s.silent.has(id)) mode = 'silent';
      a.mode = mode;
      if (mode === 'speak') {
        // Speakers mostly address the room (the camera), glancing at the chair and the mayor.
        const beat = (this.time + p.head.z * 3) % 9;
        const chief = this.people.get('chief');
        if (beat < 1.4 && chief && id !== 'chief') a.lookTarget.copy(chief.head);
        else if (beat > 7.6) a.lookTarget.copy(mayorHead);
        else a.lookTarget.copy(this.camPos);
      } else if (lookPoint) {
        a.lookTarget.copy(lookPoint);
      } else {
        a.lookTarget.set(0, 1.0, p.head.z * 0.5);
      }
      a.update(dt);
      p.mic.emissiveIntensity = mode === 'speak' ? 5 : 0;
    }

    const k = 1 - Math.exp(-2.2 * dt);
    this.camPos.lerp(this.goalPos, k);
    this.camLook.lerp(this.goalLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  /** Puts the camera at the doorway for the entrance, before it glides in. */
  enterFromDoor(): void {
    this.camPos.set(0, 1.75, ROOM_D / 2 - 0.4);
    this.camLook.set(0, 1.3, 0);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  setAo(on: boolean): void {
    (this.ao as unknown as { enabled: boolean }).enabled = on;
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / Math.max(1, h);
    // The meeting's board and captions sit along the bottom of the screen, so the picture
    // is framed above centre. Shifting the lens moves the subject up without tilting the
    // room, which a camera tilt would.
    this.camera.setViewOffset(w, h, 0, Math.round(h * LENS_LIFT), w, h);
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }
}
