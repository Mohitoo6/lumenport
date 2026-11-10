import { BufferAttribute, BufferGeometry } from 'three';

/**
 * Growable vertex/index buffers for building a mesh by hand. `extra` is an optional
 * per-vertex attribute (the road surface uses it for lane-marking coordinates).
 */
export class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private ext: number[] = [];
  private idx: number[] = [];
  count = 0;

  constructor(
    private readonly extraName: string | null = null,
    private readonly extraSize = 0,
  ) {}

  /** Adds a vertex and returns its index. */
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number, e0 = 0, e1 = 0, e2 = 0, e3 = 0, e4 = 0): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, w);
    if (this.extraSize > 0) {
      const e = [e0, e1, e2, e3, e4];
      for (let i = 0; i < this.extraSize; i++) this.ext.push(e[i]!);
    }
    return this.count++;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** Two triangles a-b-c and b-d-c: a, b are one edge and c, d the opposite edge. */
  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, b, d, c);
  }

  get empty(): boolean {
    return this.idx.length === 0;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    if (this.extraName && this.extraSize > 0) {
      // Split a 5-float payload into a vec4 and a float so it fits attribute slots.
      if (this.extraSize === 5) {
        const a = new Float32Array(this.count * 4);
        const b = new Float32Array(this.count);
        for (let i = 0; i < this.count; i++) {
          a[i * 4] = this.ext[i * 5]!;
          a[i * 4 + 1] = this.ext[i * 5 + 1]!;
          a[i * 4 + 2] = this.ext[i * 5 + 2]!;
          a[i * 4 + 3] = this.ext[i * 5 + 3]!;
          b[i] = this.ext[i * 5 + 4]!;
        }
        g.setAttribute(this.extraName, new BufferAttribute(a, 4));
        g.setAttribute(`${this.extraName}Kind`, new BufferAttribute(b, 1));
      } else {
        g.setAttribute(this.extraName, new BufferAttribute(new Float32Array(this.ext), this.extraSize));
      }
    }
    g.setIndex(this.count > 65535 ? new BufferAttribute(new Uint32Array(this.idx), 1) : new BufferAttribute(new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
