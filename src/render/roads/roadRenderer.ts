import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { CELL, CHUNK, CHUNKS } from '../../core/constants';
import { clamp } from '../../core/math';
import { bezX } from '../../sim/roads/geometry';
import { nodeLayout, type NodeLayout } from '../../sim/roads/junction';
import type { RoadChange } from '../../sim/roads/plan';
import type { RoadEdge, RoadNetwork } from '../../sim/roads/types';
import { LAMP_REACH, buildLamp } from './lampGeometry';
import { RoadMesher, newBuckets, type PropSpot, type RoadBuckets } from './roadMesher';
import type { RoadMaterials } from './roadMaterials';

const CHUNK_M = CHUNK * CELL;
const BUCKETS = ['asphalt', 'pavement', 'concrete', 'grass'] as const;
type BucketName = (typeof BUCKETS)[number];

interface ChunkRoads {
  meshes: Partial<Record<BucketName, Mesh>>;
  lamps: PropSpot[];
  trees: PropSpot[];
}

export interface RoadSource {
  roads: RoadNetwork;
  heights: Float32Array;
}

function chunkOf(x: number, z: number): number {
  const cx = clamp(Math.floor(x / CHUNK_M), 0, CHUNKS - 1);
  const cz = clamp(Math.floor(z / CHUNK_M), 0, CHUNKS - 1);
  return cz * CHUNKS + cx;
}

/**
 * Turns the road graph into meshes. Geometry is merged per chunk and per material, so a
 * city's roads cost a handful of draw calls, and an edit only rebuilds the chunks it
 * touches. Lamps and median trees are instanced across the whole map.
 */
export class RoadRenderer {
  readonly group = new Group();
  lampCount = 0;
  private readonly chunks: ChunkRoads[] = [];
  private readonly dirty = new Set<number>();
  private readonly layouts = new Map<number, NodeLayout>();
  private propsDirty = false;

  private lampBody: InstancedMesh;
  private lampLens: InstancedMesh;
  private treeMesh: InstancedMesh;
  private readonly lampGeo = buildLamp();
  private readonly lampMat = new MeshStandardMaterial({ color: new Color(0.11, 0.13, 0.14), roughness: 0.55, metalness: 0.6 });
  /** Lens material: Phase 7 raises emissiveIntensity at night. */
  readonly lensMat = new MeshStandardMaterial({ color: new Color(0.85, 0.85, 0.8), emissive: new Color(1.0, 0.82, 0.55), emissiveIntensity: 0, roughness: 0.3 });

  /** Pools of light on the ground under each lamp, faded in by `uNight`. */
  private glow: InstancedMesh;
  private readonly glowGeo: BufferGeometry;
  private readonly glowMat: ShaderMaterial;

  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly tint = new Color();

  constructor(
    private source: RoadSource,
    private readonly materials: RoadMaterials,
    treeGeo: BufferGeometry,
    treeMat: Material,
    night: { value: number },
  ) {
    this.glowGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.glowMat = new ShaderMaterial({
      uniforms: { uNight: night },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying vec2 vUv;
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          float a = pow(max(0.0, 1.0 - r), 2.2);
          gl_FragColor = vec4(vec3(1.0, 0.74, 0.42) * a * 0.55 * uNight, 1.0);
        }
      `,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    for (let i = 0; i < CHUNKS * CHUNKS; i++) this.chunks.push({ meshes: {}, lamps: [], trees: [] });
    this.lampBody = this.makeInstanced(this.lampGeo.body, this.lampMat, 256, true);
    this.lampLens = this.makeInstanced(this.lampGeo.lens, this.lensMat, 256, false);
    this.treeMesh = this.makeInstanced(treeGeo, treeMat, 128, true);
    this.glow = this.makeInstanced(this.glowGeo, this.glowMat, 256, false);
    this.glow.receiveShadow = false;
    this.glow.renderOrder = 20;
    this.rebuildAll();
  }

  private makeInstanced(geo: BufferGeometry, mat: Material, capacity: number, shadows: boolean): InstancedMesh {
    const mesh = new InstancedMesh(geo, mat, capacity);
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    return mesh;
  }

  /** Lamps come on at dusk. */
  setNight(night: number): void {
    this.lensMat.emissiveIntensity = night * 7;
    this.glow.visible = night > 0.02;
  }

  setSource(source: RoadSource): void {
    this.source = source;
    this.rebuildAll();
  }

  rebuildAll(): void {
    this.layouts.clear();
    for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i);
    this.update();
  }

  private edgeChunk(e: RoadEdge): number {
    const net = this.source.roads;
    const a = net.nodes[e.a]!;
    const b = net.nodes[e.b]!;
    return chunkOf(bezX(a.x, e.cx, b.x, 0.5), bezX(a.z, e.cz, b.z, 0.5));
  }

  /** Marks every chunk whose road geometry could have changed. */
  onChange(change: RoadChange): void {
    this.layouts.clear();
    const net = this.source.roads;
    for (const id of change.nodes) {
      const n = net.nodes[id];
      if (!n) continue;
      this.dirty.add(chunkOf(n.x, n.z));
      // A neighbouring edge is cut back differently when its junction changes.
      for (const eid of n.edges) this.dirty.add(this.edgeChunk(net.edges[eid]!));
    }
    // Removed pieces are gone from the graph, so cover their bounds too.
    if (change.x1 >= change.x0) {
      const cx0 = clamp(Math.floor(change.x0 / CHUNK_M), 0, CHUNKS - 1);
      const cx1 = clamp(Math.floor(change.x1 / CHUNK_M), 0, CHUNKS - 1);
      const cz0 = clamp(Math.floor(change.z0 / CHUNK_M), 0, CHUNKS - 1);
      const cz1 = clamp(Math.floor(change.z1 / CHUNK_M), 0, CHUNKS - 1);
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) this.dirty.add(cz * CHUNKS + cx);
    }
  }

  private layoutOf = (node: number): NodeLayout => {
    let l = this.layouts.get(node);
    if (!l) {
      l = nodeLayout(this.source.roads, node);
      this.layouts.set(node, l);
    }
    return l;
  };

  /** Rebuilds dirty chunks. Call once per frame; it does nothing when the roads are unchanged. */
  update(): void {
    if (this.dirty.size === 0) return;
    const net = this.source.roads;
    const mesher = new RoadMesher(net, this.source.heights, this.layoutOf);
    const buckets = new Map<number, RoadBuckets>();
    for (const c of this.dirty) buckets.set(c, newBuckets());

    for (const e of net.edges) {
      if (!e) continue;
      const b = buckets.get(this.edgeChunk(e));
      if (b) mesher.buildEdge(e, b);
    }
    for (const n of net.nodes) {
      if (!n) continue;
      const b = buckets.get(chunkOf(n.x, n.z));
      if (b) mesher.buildNode(n, b);
    }

    for (const [c, b] of buckets) {
      const chunk = this.chunks[c]!;
      for (const name of BUCKETS) {
        const old = chunk.meshes[name];
        if (old) {
          this.group.remove(old);
          old.geometry.dispose();
          delete chunk.meshes[name];
        }
        const mb = b[name];
        if (mb.empty) continue;
        const mesh = new Mesh(mb.build(), this.materials[name]);
        mesh.receiveShadow = true;
        // Flat surfaces cast nothing useful; bridges and curbs are in the concrete bucket.
        mesh.castShadow = name === 'concrete';
        mesh.matrixAutoUpdate = false;
        chunk.meshes[name] = mesh;
        this.group.add(mesh);
      }
      chunk.lamps = b.lamps;
      chunk.trees = b.trees;
      this.propsDirty = true;
    }
    this.dirty.clear();
    if (this.propsDirty) this.rebuildProps();
  }

  private ensureCapacity(mesh: InstancedMesh, needed: number, shadows: boolean): InstancedMesh {
    if (needed <= mesh.instanceMatrix.count) return mesh;
    let cap = mesh.instanceMatrix.count;
    while (cap < needed) cap *= 2;
    this.group.remove(mesh);
    mesh.dispose();
    return this.makeInstanced(mesh.geometry, mesh.material as Material, cap, shadows);
  }

  private rebuildProps(): void {
    this.propsDirty = false;
    let lamps = 0;
    let trees = 0;
    for (const c of this.chunks) {
      lamps += c.lamps.length;
      trees += c.trees.length;
    }
    this.lampBody = this.ensureCapacity(this.lampBody, lamps, true);
    this.lampLens = this.ensureCapacity(this.lampLens, lamps, false);
    this.treeMesh = this.ensureCapacity(this.treeMesh, trees, true);
    const hadGlow = this.glow;
    this.glow = this.ensureCapacity(this.glow, lamps, false);
    if (this.glow !== hadGlow) {
      this.glow.receiveShadow = false;
      this.glow.renderOrder = 20;
    }

    let i = 0;
    let t = 0;
    this.s.set(1, 1, 1);
    for (const c of this.chunks) {
      for (const l of c.lamps) {
        this.q.setFromAxisAngle(this.up, l.rot);
        this.p.set(l.x, l.y, l.z);
        this.s.set(1, 1, 1);
        this.m.compose(this.p, this.q, this.s);
        this.lampBody.setMatrixAt(i, this.m);
        this.lampLens.setMatrixAt(i, this.m);
        // Light pool centred under the lamp head, just above the sidewalk.
        this.p.set(l.x + Math.sin(l.rot) * LAMP_REACH, l.y + 0.12, l.z + Math.cos(l.rot) * LAMP_REACH);
        this.s.set(19, 1, 19);
        this.m.compose(this.p, this.q, this.s);
        this.glow.setMatrixAt(i, this.m);
        i++;
      }
      for (const tr of c.trees) {
        this.q.setFromAxisAngle(this.up, tr.rot);
        this.p.set(tr.x, tr.y - 0.2, tr.z);
        const k = 0.5 + 0.12 * Math.abs(Math.sin(tr.rot * 3.1));
        this.s.set(k, k * 1.08, k);
        this.m.compose(this.p, this.q, this.s);
        this.treeMesh.setMatrixAt(t, this.m);
        const v = 0.9 + 0.2 * Math.abs(Math.sin(tr.rot * 1.3));
        this.tint.setRGB(v, v * 1.02, v * 0.9);
        this.treeMesh.setColorAt(t, this.tint);
        t++;
      }
    }
    this.lampBody.count = lamps;
    this.lampLens.count = lamps;
    this.glow.count = lamps;
    this.glow.instanceMatrix.needsUpdate = true;
    this.treeMesh.count = trees;
    this.lampBody.instanceMatrix.needsUpdate = true;
    this.lampLens.instanceMatrix.needsUpdate = true;
    this.treeMesh.instanceMatrix.needsUpdate = true;
    if (this.treeMesh.instanceColor) this.treeMesh.instanceColor.needsUpdate = true;
    this.lampCount = lamps;
  }
}
