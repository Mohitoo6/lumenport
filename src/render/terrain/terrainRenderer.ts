import { BufferAttribute, BufferGeometry, Group, Mesh, type Material } from 'three';
import { CELL, CHUNK, CHUNKS, MAP, VERTS, WORLD } from '../../core/constants';
import { terrainHeight } from '../../sim/map/terrain';
import type { CellRect } from '../../sim/sim';

const SIDE = CHUNK + 1;
const SKIRT_DEPTH = 45;

/**
 * Draws the height field. The playable map is split into CHUNK x CHUNK cell meshes so
 * edits only rebuild what changed and off-screen parts are culled. A coarse backdrop
 * mesh continues the same analytic terrain out to the horizon.
 */
export class TerrainRenderer {
  readonly group = new Group();
  private readonly chunks: Mesh[] = [];
  private extras: Mesh[] = [];
  private readonly index: BufferAttribute;

  constructor(
    private heights: Float32Array,
    private seed: number,
    private readonly material: Material,
  ) {
    const idx = new Uint16Array(CHUNK * CHUNK * 6);
    let k = 0;
    for (let j = 0; j < CHUNK; j++) {
      for (let i = 0; i < CHUNK; i++) {
        const a = j * SIDE + i;
        const b = a + 1;
        const c = a + SIDE;
        const d = c + 1;
        idx[k++] = a;
        idx[k++] = c;
        idx[k++] = b;
        idx[k++] = b;
        idx[k++] = c;
        idx[k++] = d;
      }
    }
    this.index = new BufferAttribute(idx, 1);

    for (let cz = 0; cz < CHUNKS; cz++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        const geo = new BufferGeometry();
        geo.setIndex(this.index);
        geo.setAttribute('position', new BufferAttribute(new Float32Array(SIDE * SIDE * 3), 3));
        geo.setAttribute('normal', new BufferAttribute(new Float32Array(SIDE * SIDE * 3), 3));
        const mesh = new Mesh(geo, material);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.matrixAutoUpdate = false;
        this.chunks.push(mesh);
        this.group.add(mesh);
        this.fillChunk(cx, cz);
      }
    }
    this.buildExtras();
  }

  private buildExtras(): void {
    for (const m of this.extras) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.extras = [this.buildSkirt(), this.buildBackdrop()];
    for (const m of this.extras) this.group.add(m);
  }

  /** Installs a new height field (new game or load) and rebuilds everything. */
  setHeights(heights: Float32Array, seed: number): void {
    this.heights = heights;
    this.seed = seed;
    for (let cz = 0; cz < CHUNKS; cz++) for (let cx = 0; cx < CHUNKS; cx++) this.fillChunk(cx, cz);
    this.buildExtras();
  }

  /** Rebuilds the chunks touched by a rectangle of changed vertices. */
  updateRect(r: CellRect): void {
    // Normals read one vertex beyond the change, so grow the rectangle by one.
    const cx0 = Math.max(0, Math.floor((r.x0 - 1) / CHUNK));
    const cz0 = Math.max(0, Math.floor((r.y0 - 1) / CHUNK));
    const cx1 = Math.min(CHUNKS - 1, Math.floor((r.x1 + 1) / CHUNK));
    const cz1 = Math.min(CHUNKS - 1, Math.floor((r.y1 + 1) / CHUNK));
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) this.fillChunk(cx, cz);
  }

  private h(i: number, j: number): number {
    if (i < 0 || j < 0 || i > MAP || j > MAP) return terrainHeight(i * CELL, j * CELL, this.seed);
    return this.heights[j * VERTS + i]!;
  }

  private fillChunk(cx: number, cz: number): void {
    const mesh = this.chunks[cz * CHUNKS + cx]!;
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position') as BufferAttribute;
    const nor = geo.getAttribute('normal') as BufferAttribute;
    const p = pos.array as Float32Array;
    const n = nor.array as Float32Array;
    let k = 0;
    for (let j = 0; j < SIDE; j++) {
      const gj = cz * CHUNK + j;
      for (let i = 0; i < SIDE; i++) {
        const gi = cx * CHUNK + i;
        p[k] = gi * CELL;
        p[k + 1] = this.h(gi, gj);
        p[k + 2] = gj * CELL;
        const nx = this.h(gi - 1, gj) - this.h(gi + 1, gj);
        const nz = this.h(gi, gj - 1) - this.h(gi, gj + 1);
        const ny = 2 * CELL;
        const inv = 1 / Math.hypot(nx, ny, nz);
        n[k] = nx * inv;
        n[k + 1] = ny * inv;
        n[k + 2] = nz * inv;
        k += 3;
      }
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
  }

  /** A wall hanging from the map border, hiding hairline gaps where it meets the backdrop. */
  private buildSkirt(): Mesh {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const edge = (x0: number, z0: number, dx: number, dz: number): void => {
      const base = positions.length / 3;
      for (let s = 0; s <= MAP; s++) {
        const i = x0 + dx * s;
        const j = z0 + dz * s;
        const y = this.h(i, j);
        positions.push(i * CELL, y, j * CELL, i * CELL, y - SKIRT_DEPTH, j * CELL);
        normals.push(0, 1, 0, 0, 1, 0);
        if (s < MAP) {
          const a = base + s * 2;
          indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3, a, a + 2, a + 1, a + 2, a + 3, a + 1);
        }
      }
    };
    edge(0, 0, 1, 0);
    edge(0, MAP, 1, 0);
    edge(0, 0, 0, 1);
    edge(MAP, 0, 0, 1);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    geo.setIndex(indices);
    const mesh = new Mesh(geo, this.material);
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  /**
   * Terrain beyond the playable square, on a grid that coarsens with distance. It shares
   * border vertices with the map every 64 m; the skirts cover the gaps in between.
   */
  private buildBackdrop(): Mesh {
    const inner: number[] = [];
    for (let v = 0; v <= WORLD; v += 64) inner.push(v);
    const steps = [64, 64, 64, 96, 128, 192, 256, 384, 512, 768, 1024, 1024, 1536, 1536, 2048, 2048];
    const lo: number[] = [];
    const hi: number[] = [];
    let a = 0;
    let b = WORLD;
    for (const s of steps) {
      a -= s;
      b += s;
      lo.unshift(a);
      hi.push(b);
    }
    const axis = [...lo, ...inner, ...hi];
    const n = axis.length;
    const i0 = lo.length;
    const i1 = lo.length + inner.length - 1;

    const positions = new Float32Array(n * n * 3);
    const normals = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = axis[i]!;
        const z = axis[j]!;
        const k = (j * n + i) * 3;
        positions[k] = x;
        positions[k + 1] = terrainHeight(x, z, this.seed);
        positions[k + 2] = z;
        const e = 24;
        const nx = terrainHeight(x - e, z, this.seed) - terrainHeight(x + e, z, this.seed);
        const nz = terrainHeight(x, z - e, this.seed) - terrainHeight(x, z + e, this.seed);
        const inv = 1 / Math.hypot(nx, 2 * e, nz);
        normals[k] = nx * inv;
        normals[k + 1] = 2 * e * inv;
        normals[k + 2] = nz * inv;
      }
    }
    const indices: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        if (i >= i0 && i < i1 && j >= i0 && j < i1) continue; // hole for the playable map
        const p = j * n + i;
        indices.push(p, p + n, p + 1, p + 1, p + n, p + n + 1);
      }
    }

    // Skirt around the hole.
    const pos: number[] = Array.from(positions);
    const nor: number[] = Array.from(normals);
    const ring: number[] = [];
    for (let i = i0; i <= i1; i++) ring.push(i0 * n + i);
    for (let j = i0 + 1; j <= i1; j++) ring.push(j * n + i1);
    for (let i = i1 - 1; i >= i0; i--) ring.push(i1 * n + i);
    for (let j = i1 - 1; j > i0; j--) ring.push(j * n + i0);
    const base = pos.length / 3;
    for (const v of ring) {
      pos.push(positions[v * 3]!, positions[v * 3 + 1]! - SKIRT_DEPTH, positions[v * 3 + 2]!);
      nor.push(0, 1, 0);
    }
    for (let s = 0; s < ring.length; s++) {
      const t = (s + 1) % ring.length;
      const a0 = ring[s]!;
      const a1 = ring[t]!;
      const b0 = base + s;
      const b1 = base + t;
      indices.push(a0, b0, a1, a1, b0, b1, a0, a1, b0, a1, b1, b0);
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
    geo.setIndex(indices);
    const mesh = new Mesh(geo, this.material);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    return mesh;
  }
}
