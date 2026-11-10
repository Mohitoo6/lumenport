import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type Material,
} from 'three';
import { MAP } from '../../core/constants';
import { stageOf, type Building } from '../../sim/zoning/zones';
import { generateBuilding } from './generate';
import type { Geo, TreeSpot } from './geo';

/** Buildings are merged in blocks of this many cells a side. */
const BLOCK = 16;
const BLOCKS = MAP / BLOCK;

/** One building's geometry, packed into typed arrays ready to be copied into a block mesh. */
interface Packed {
  key: number;
  block: number;
  count: number;
  /** Height of the building above its pad, for picking. */
  height: number;
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  tint: Float32Array;
  a: Float32Array;
  b: Float32Array;
  idx: Uint32Array;
  trees: TreeSpot[];
}

function pack(g: Geo, key: number, block: number): Packed {
  return {
    key,
    block,
    count: g.count,
    height: g.maxY,
    pos: new Float32Array(g.pos),
    nor: new Float32Array(g.nor),
    uv: new Float32Array(g.uv),
    tint: new Float32Array(g.tint),
    a: new Float32Array(g.a),
    b: new Float32Array(g.b),
    idx: new Uint32Array(g.idx),
    trees: g.trees,
  };
}

function blockOf(b: { x: number; y: number; w: number; h: number }): number {
  const bx = Math.min(BLOCKS - 1, Math.floor((b.x + b.w / 2) / BLOCK));
  const by = Math.min(BLOCKS - 1, Math.floor((b.y + b.h / 2) / BLOCK));
  return by * BLOCKS + bx;
}

/**
 * Draws every building. Each building's mesh is generated once per visible state and
 * cached; all buildings in a 128 m block are then merged into a single mesh that uses the
 * shared city material, so a whole district is a handful of draw calls. Garden and street
 * trees on lots share one instanced mesh.
 */
export class BuildingRenderer {
  readonly group = new Group();
  buildingCount = 0;
  private readonly cache = new Map<number, Packed>();
  private readonly blocks: Array<Set<number>> = [];
  private readonly meshes: Array<Mesh | null> = [];
  private readonly dirty = new Set<number>();
  private treeMesh: InstancedMesh;
  private treesDirty = false;

  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly tintColor = new Color();

  constructor(
    private buildings: ReadonlyArray<Building | null>,
    private readonly material: Material,
    private readonly treeGeo: BufferGeometry,
    private readonly treeMat: Material,
  ) {
    for (let i = 0; i < BLOCKS * BLOCKS; i++) {
      this.blocks.push(new Set());
      this.meshes.push(null);
    }
    this.treeMesh = this.makeTrees(256);
    this.rebuildAll();
  }

  private makeTrees(capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(this.treeGeo, this.treeMat, capacity);
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    return mesh;
  }

  setSource(buildings: ReadonlyArray<Building | null>): void {
    this.buildings = buildings;
    this.rebuildAll();
  }

  rebuildAll(): void {
    this.cache.clear();
    for (let i = 0; i < this.blocks.length; i++) {
      this.blocks[i]!.clear();
      this.dirty.add(i);
    }
    this.buildingCount = 0;
    for (const b of this.buildings) {
      if (!b) continue;
      this.blocks[blockOf(b)]!.add(b.id);
      this.buildingCount++;
    }
    this.update(Infinity);
  }

  onChange(change: { changed: number[]; removed: Building[] }): void {
    for (const b of change.removed) {
      const block = blockOf(b);
      if (this.blocks[block]!.delete(b.id)) this.buildingCount--;
      this.cache.delete(b.id);
      this.dirty.add(block);
    }
    for (const id of change.changed) {
      const b = this.buildings[id];
      if (!b) continue;
      const block = blockOf(b);
      if (!this.blocks[block]!.has(id)) {
        this.blocks[block]!.add(id);
        this.buildingCount++;
      }
      this.dirty.add(block);
    }
  }

  /** Height above the pad of a building's current mesh (0 if it has not been built yet). */
  heightOf(id: number): number {
    return this.cache.get(id)?.height ?? 0;
  }

  /** A building's packed mesh, regenerated only when its stage or level changed. */
  private packed(b: Building, block: number): Packed {
    const key = stageOf(b.progress) * 8 + b.level;
    let p = this.cache.get(b.id);
    if (!p || p.key !== key) {
      p = pack(generateBuilding(b), key, block);
      this.cache.set(b.id, p);
    }
    return p;
  }

  /** Rebuilds dirty blocks until the time budget (milliseconds) runs out. */
  update(budgetMs = 5): void {
    if (this.dirty.size === 0) return;
    const start = performance.now();
    for (const block of this.dirty) {
      this.rebuildBlock(block);
      this.dirty.delete(block);
      if (performance.now() - start > budgetMs) break;
    }
    if (this.treesDirty && this.dirty.size === 0) this.rebuildTrees();
  }

  private rebuildBlock(block: number): void {
    const old = this.meshes[block];
    if (old) {
      this.group.remove(old);
      old.geometry.dispose();
      this.meshes[block] = null;
    }
    this.treesDirty = true;
    const parts: Packed[] = [];
    let verts = 0;
    let indices = 0;
    for (const id of this.blocks[block]!) {
      const b = this.buildings[id];
      if (!b) continue;
      const p = this.packed(b, block);
      parts.push(p);
      verts += p.count;
      indices += p.idx.length;
    }
    if (verts === 0) return;
    const pos = new Float32Array(verts * 3);
    const nor = new Float32Array(verts * 3);
    const uv = new Float32Array(verts * 2);
    const tint = new Float32Array(verts * 3);
    const a = new Float32Array(verts * 4);
    const bb = new Float32Array(verts * 4);
    const idx = new Uint32Array(indices);
    let v = 0;
    let k = 0;
    for (const p of parts) {
      pos.set(p.pos, v * 3);
      nor.set(p.nor, v * 3);
      uv.set(p.uv, v * 2);
      tint.set(p.tint, v * 3);
      a.set(p.a, v * 4);
      bb.set(p.b, v * 4);
      for (let i = 0; i < p.idx.length; i++) idx[k + i] = p.idx[i]! + v;
      v += p.count;
      k += p.idx.length;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('normal', new BufferAttribute(nor, 3));
    geo.setAttribute('uv', new BufferAttribute(uv, 2));
    geo.setAttribute('aTint', new BufferAttribute(tint, 3));
    geo.setAttribute('aA', new BufferAttribute(a, 4));
    geo.setAttribute('aB', new BufferAttribute(bb, 4));
    geo.setIndex(new BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new Mesh(geo, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.meshes[block] = mesh;
    this.group.add(mesh);
  }

  private rebuildTrees(): void {
    this.treesDirty = false;
    let n = 0;
    for (const p of this.cache.values()) n += p.trees.length;
    if (n > this.treeMesh.instanceMatrix.count) {
      let cap = this.treeMesh.instanceMatrix.count;
      while (cap < n) cap *= 2;
      this.group.remove(this.treeMesh);
      this.treeMesh.dispose();
      this.treeMesh = this.makeTrees(cap);
    }
    let i = 0;
    for (const p of this.cache.values()) {
      for (const t of p.trees) {
        this.q.setFromAxisAngle(this.up, t.rot);
        this.p.set(t.x, t.y - 0.2, t.z);
        this.s.set(t.scale, t.scale * 1.05, t.scale);
        this.m.compose(this.p, this.q, this.s);
        this.treeMesh.setMatrixAt(i, this.m);
        const k = 0.88 + 0.24 * Math.abs(Math.sin(t.rot * 2.3));
        this.tintColor.setRGB(k, k * 1.03, k * 0.9);
        this.treeMesh.setColorAt(i, this.tintColor);
        i++;
      }
    }
    this.treeMesh.count = n;
    this.treeMesh.instanceMatrix.needsUpdate = true;
    if (this.treeMesh.instanceColor) this.treeMesh.instanceColor.needsUpdate = true;
  }
}
