import { Color, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3, type BufferGeometry, type Texture } from 'three';
import { CELL, CHUNK, CHUNKS, MAP } from '../../core/constants';
import { heightAt } from '../../sim/map/terrain';
import { TREE_SPECIES_COUNT, treeInstances, type TreeInstance, type TreeSpecies } from '../../sim/map/trees';
import type { CellRect } from '../../sim/sim';
import { buildTree, type TreeLods } from './treeGeometry';

const LOD_NEAR = 300;
const LOD_FAR = 900;

interface ChunkTrees {
  meshes: Array<InstancedMesh | null>;
  cx: number;
  cz: number;
  lod: number;
}

/**
 * Instanced trees, one InstancedMesh per chunk and species so whole chunks are frustum
 * culled and switch detail level together. Tree positions come from the sim's per-cell
 * tree bytes.
 */
export class TreeRenderer {
  readonly group = new Group();
  readonly material: MeshStandardMaterial;
  count = 0;
  private readonly species: TreeLods[] = [];
  private readonly chunks: ChunkTrees[] = [];
  private readonly scratch: TreeInstance[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly color = new Color();

  constructor(
    private trees: Uint8Array,
    private heights: Float32Array,
    shared: { uTime: { value: number } },
    noise: Texture,
  ) {
    for (let i = 0; i < TREE_SPECIES_COUNT; i++) this.species.push(buildTree(i as TreeSpecies));

    this.material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, envMapIntensity: 0.85 });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = shared.uTime;
      shader.uniforms.uNoise = { value: noise };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vTreeW;')
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          #ifdef USE_INSTANCING
            // Wind: the crown leans and shivers, the base stays planted.
            float swPhase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.51;
            float swAmt = max(position.y - 1.5, 0.0) * 0.011;
            transformed.x += sin(uTime * 1.3 + swPhase) * swAmt + sin(uTime * 3.1 + swPhase * 1.7 + position.y) * swAmt * 0.3;
            transformed.z += cos(uTime * 1.1 + swPhase * 1.3) * swAmt;
            vTreeW = (instanceMatrix * vec4(position, 1.0)).xyz;
          #else
            vTreeW = position;
          #endif`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uNoise;\nvarying vec3 vTreeW;')
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          // Leaf clumps: two octaves of noise mottle the colour and, below, bump the normal,
          // so the smooth crown volumes read as foliage rather than clay.
          vec3 tq = vTreeW * 0.42;
          // Three axis-aligned projections summed: no streaks on any face orientation.
          vec3 tLeafV = vec3(
            texture2D(uNoise, tq.xz).r,
            texture2D(uNoise, tq.xy + 0.31).g,
            texture2D(uNoise, tq.zy + 0.67).b);
          vec3 tLeafF = vec3(
            texture2D(uNoise, tq.xz * 3.7 + 0.5).g,
            texture2D(uNoise, tq.xy * 3.7 + 0.13).b,
            texture2D(uNoise, tq.zy * 3.7 + 0.29).r);
          float tLeaf = dot(tLeafV, vec3(0.2)) + dot(tLeafF, vec3(0.1333));
          diffuseColor.rgb *= 0.42 + 1.16 * tLeaf;`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          // Scatter the normal with the same noise so highlights break up like leaves.
          'normal = normalize(normal + (tLeafV + tLeafF - 1.0) * 0.55);',
        );
    };
    this.material.customProgramCacheKey = () => 'tree-v3';

    for (let cz = 0; cz < CHUNKS; cz++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        this.chunks.push({ meshes: new Array<InstancedMesh | null>(TREE_SPECIES_COUNT).fill(null), cx, cz, lod: 1 });
      }
    }
    this.rebuildAll();
  }

  /** Shared tree geometry, for other renderers that plant trees (road medians, parks). */
  lodGeometry(species: TreeSpecies, lod: 0 | 1 | 2): BufferGeometry {
    return this.species[species]!.lods[lod];
  }

  setSource(trees: Uint8Array, heights: Float32Array): void {
    this.trees = trees;
    this.heights = heights;
    this.rebuildAll();
  }

  rebuildAll(): void {
    this.count = 0;
    for (const c of this.chunks) this.rebuildChunk(c);
  }

  updateRect(r: CellRect): void {
    const cx0 = Math.max(0, Math.floor(r.x0 / CHUNK));
    const cz0 = Math.max(0, Math.floor(r.y0 / CHUNK));
    const cx1 = Math.min(CHUNKS - 1, Math.floor(r.x1 / CHUNK));
    const cz1 = Math.min(CHUNKS - 1, Math.floor(r.y1 / CHUNK));
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) this.rebuildChunk(this.chunks[cz * CHUNKS + cx]!);
  }

  private rebuildChunk(chunk: ChunkTrees): void {
    for (let sp = 0; sp < TREE_SPECIES_COUNT; sp++) {
      const old = chunk.meshes[sp];
      if (old) {
        this.count -= old.count;
        this.group.remove(old);
        old.dispose();
        chunk.meshes[sp] = null;
      }
    }
    const list = this.scratch;
    list.length = 0;
    const i0 = chunk.cx * CHUNK;
    const j0 = chunk.cz * CHUNK;
    for (let j = j0; j < j0 + CHUNK; j++) {
      for (let i = i0; i < i0 + CHUNK; i++) {
        const code = this.trees[j * MAP + i]!;
        if (code !== 0) treeInstances(code, i, j, list);
      }
    }
    if (list.length === 0) return;
    const counts = new Array<number>(TREE_SPECIES_COUNT).fill(0);
    for (const t of list) counts[t.species]!++;
    for (let sp = 0; sp < TREE_SPECIES_COUNT; sp++) {
      const n = counts[sp]!;
      if (n === 0) continue;
      const mesh = new InstancedMesh(this.species[sp]!.lods[chunk.lod] as BufferGeometry, this.material, n);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      let k = 0;
      for (const t of list) {
        if (t.species !== sp) continue;
        this.q.setFromAxisAngle(this.up, t.rotation);
        this.p.set(t.x, heightAt(this.heights, t.x, t.z) - 0.25, t.z);
        this.s.set(t.scale, t.scale * (0.9 + t.tint * 0.24), t.scale);
        this.m.compose(this.p, this.q, this.s);
        mesh.setMatrixAt(k, this.m);
        // Per-tree tint: slightly drier or lusher, lighter or darker.
        const v = 0.82 + 0.34 * ((t.tint * 7.13) % 1);
        this.color.setRGB(v * (0.92 + 0.26 * t.tint), v, v * (0.82 + 0.2 * (1 - t.tint)));
        mesh.setColorAt(k, this.color);
        k++;
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      chunk.meshes[sp] = mesh;
      this.group.add(mesh);
      this.count += n;
    }
  }

  /** Picks a detail level per chunk from camera distance. Cheap enough to run every frame. */
  updateLod(camera: Vector3): void {
    const half = (CHUNK * CELL) / 2;
    for (const c of this.chunks) {
      const dx = c.cx * CHUNK * CELL + half - camera.x;
      const dz = c.cz * CHUNK * CELL + half - camera.z;
      const d = Math.hypot(dx, dz, camera.y) - half;
      const lod = d < LOD_NEAR ? 0 : d < LOD_FAR ? 1 : 2;
      if (lod === c.lod) continue;
      c.lod = lod;
      for (let sp = 0; sp < TREE_SPECIES_COUNT; sp++) {
        const mesh = c.meshes[sp];
        if (mesh) mesh.geometry = this.species[sp]!.lods[lod] as BufferGeometry;
      }
    }
  }
}
