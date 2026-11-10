import { BufferAttribute, BufferGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, lerp, smoothstep } from '../../core/math';
import { TreeSpecies } from '../../sim/map/trees';

type RGB = [number, number, number];

/** Smooth pseudo-noise of a direction, identical for duplicated vertices. */
function wobble(x: number, y: number, z: number, seed: number): number {
  return (
    Math.sin(x * 5.1 + seed) * Math.sin(y * 4.3 + seed * 1.7) * Math.sin(z * 6.2 + seed * 0.3) +
    0.5 * Math.sin(x * 11.3 + seed * 2.1) * Math.sin(z * 9.7 + y * 3.1 + seed)
  );
}

function withColor(geo: BufferGeometry, fn: (x: number, y: number, z: number) => RGB): BufferGeometry {
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function trunk(height: number, rBottom: number, rTop: number, sides: number, color: RGB): BufferGeometry {
  const g = new CylinderGeometry(rTop, rBottom, height, sides, 1, true).toNonIndexed();
  g.translate(0, height / 2 - 0.3, 0);
  return withColor(g, (_x, y) => {
    const k = 0.75 + 0.35 * clamp(y / height, 0, 1);
    return [color[0] * k, color[1] * k, color[2] * k];
  });
}

interface Blob {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

interface Canopy {
  blobs: Blob[];
  /** Centre and half-extents of the whole crown, for shading. */
  cy: number;
  halfH: number;
  radius: number;
  leaf: RGB;
}

/**
 * A crown made of lumpy spheres. Normals are bent toward "outward from the crown centre"
 * so the cluster shades as one soft volume instead of separate balls, and vertex colour
 * darkens the underside and interior to fake self-shadowing.
 */
function canopy(c: Canopy, detail: number, seed: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  c.blobs.forEach((b, bi) => {
    const g = new IcosahedronGeometry(1, detail);
    const pos = g.getAttribute('position');
    const nor = new Float32Array(pos.count * 3);
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i);
      const dy = pos.getY(i);
      const dz = pos.getZ(i);
      const d = 1 + wobble(dx, dy, dz, seed + bi * 7.3) * (detail > 0 ? 0.26 : 0.1);
      const x = b.x + dx * b.rx * d;
      const y = b.y + dy * b.ry * d;
      const z = b.z + dz * b.rz * d;
      pos.setXYZ(i, x, y, z);

      // Blend the sphere normal with the direction from the crown centre.
      const ox = x;
      const oy = (y - c.cy) * (c.radius / c.halfH);
      const oz = z;
      const ol = Math.hypot(ox, oy, oz) || 1;
      let nx = lerp(dx, ox / ol, 0.6);
      let ny = lerp(dy, oy / ol, 0.6) + 0.15;
      let nz = lerp(dz, oz / ol, 0.6);
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      nor[i * 3] = nx;
      nor[i * 3 + 1] = ny;
      nor[i * 3 + 2] = nz;

      const up = clamp((y - (c.cy - c.halfH)) / (2 * c.halfH), 0, 1);
      const out = clamp(Math.hypot(x, z) / c.radius, 0, 1);
      const shade = (0.5 + 0.62 * smoothstep(0, 1, up)) * (0.72 + 0.3 * out) * (0.94 + 0.12 * wobble(dx * 2, dy * 2, dz * 2, seed + 40));
      // Sunlit tips drift slightly yellow.
      col[i * 3] = c.leaf[0] * shade * (1 + 0.25 * up);
      col[i * 3 + 1] = c.leaf[1] * shade * (1 + 0.1 * up);
      col[i * 3 + 2] = c.leaf[2] * shade;
    }
    g.setAttribute('normal', new BufferAttribute(nor, 3));
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    parts.push(g);
  });
  return mergeGeometries(parts)!;
}

function ring(n: number, radius: number, y: number, r: number, squash: number, seed: number): Blob[] {
  const out: Blob[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed;
    const jitter = 0.85 + 0.3 * Math.abs(Math.sin(seed * 3.7 + i * 2.1));
    out.push({
      x: Math.cos(a) * radius,
      y: y + Math.sin(seed + i * 1.9) * r * 0.25,
      z: Math.sin(a) * radius,
      rx: r * jitter,
      ry: r * squash * jitter,
      rz: r * jitter,
    });
  }
  return out;
}

/** Layered conifer: stacked skirts with ragged rims. */
function conifer(tiers: number, height: number, radius: number, sides: number, leaf: RGB, seed: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const base = height * 0.09;
  for (let t = 0; t < tiers; t++) {
    const k = t / tiers;
    const r = radius * (1 - k * 0.78);
    const y0 = base + (height - base) * k * 0.86;
    const h = ((height - base) / tiers) * 1.75;
    const g = new ConeGeometry(r, h, sides, 1, true).toNonIndexed();
    g.translate(0, y0 + h / 2, 0);
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const rim = 1 - clamp((y - y0) / h, 0, 1);
      const a = Math.atan2(z, x);
      const d = 1 + rim * (0.16 * Math.sin(a * 5 + seed + t * 1.3) + 0.1 * Math.sin(a * 9 + seed * 2.1));
      pos.setXYZ(i, x * d, y - rim * 0.25 * Math.abs(Math.sin(a * 3 + t + seed)), z * d);
      // Tilt normals up so tiers catch sky light like needles would.
      const nx = nor.getX(i);
      const ny = nor.getY(i) + 0.45;
      const nz = nor.getZ(i);
      const nl = Math.hypot(nx, ny, nz);
      nor.setXYZ(i, nx / nl, ny / nl, nz / nl);
    }
    withColor(g, (_x, y) => {
      const tip = clamp((y - y0) / h, 0, 1);
      const shade = (0.62 + 0.5 * tip) * (0.8 + 0.3 * k);
      return [leaf[0] * shade, leaf[1] * shade, leaf[2] * shade];
    });
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}

export interface TreeLods {
  /** Three detail levels: full, reduced, and a single low-poly crown for the far distance. */
  lods: [BufferGeometry, BufferGeometry, BufferGeometry];
  /** Rough height in metres at scale 1, for bounds. */
  height: number;
}

function finish(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts)!;
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

const BARK: RGB = [0.16, 0.115, 0.08];
const BARK_BIRCH: RGB = [0.62, 0.6, 0.55];

/** Builds the mesh set for one species. Colours are linear albedo. */
export function buildTree(species: TreeSpecies): TreeLods {
  switch (species) {
    case TreeSpecies.Oak: {
      const leaf: RGB = [0.105, 0.2, 0.05];
      const blobs = [
        ...ring(5, 2.8, 4.9, 2.5, 0.74, 0.4),
        ...ring(4, 1.7, 6.9, 2.5, 0.8, 1.9),
        { x: 0.2, y: 8.7, z: -0.1, rx: 2.7, ry: 2.1, rz: 2.7 },
        { x: 0, y: 5.6, z: 0, rx: 3.1, ry: 2.3, rz: 3.1 },
      ];
      const c: Canopy = { blobs, cy: 6.7, halfH: 3.9, radius: 5.3, leaf };
      const far: Canopy = { ...c, blobs: [{ x: 0, y: 6.7, z: 0, rx: 5.0, ry: 3.9, rz: 5.0 }] };
      const mid: Canopy = { ...c, blobs: [...ring(4, 2.4, 5.4, 3.0, 0.8, 0.4), { x: 0, y: 8.0, z: 0, rx: 3.3, ry: 2.7, rz: 3.3 }] };
      return {
        lods: [
          finish([trunk(5.6, 0.62, 0.36, 7, BARK), canopy(c, 1, 1.1)]),
          finish([trunk(5.6, 0.62, 0.36, 4, BARK), canopy(mid, 0, 1.1)]),
          finish([canopy(far, 0, 1.1)]),
        ],
        height: 11,
      };
    }
    case TreeSpecies.Birch: {
      const leaf: RGB = [0.19, 0.29, 0.07];
      const blobs = [...ring(3, 1.3, 5.6, 1.9, 1.0, 2.2), ...ring(3, 1.0, 8.2, 1.8, 1.05, 0.7), { x: 0, y: 10.6, z: 0, rx: 1.6, ry: 1.9, rz: 1.6 }];
      const c: Canopy = { blobs, cy: 8.0, halfH: 4.6, radius: 3.2, leaf };
      const far: Canopy = { ...c, blobs: [{ x: 0, y: 8.0, z: 0, rx: 2.9, ry: 4.5, rz: 2.9 }] };
      const mid: Canopy = { ...c, blobs: [...ring(3, 1.1, 6.2, 2.2, 1.05, 2.2), { x: 0, y: 9.6, z: 0, rx: 2.0, ry: 2.6, rz: 2.0 }] };
      return {
        lods: [
          finish([trunk(8.5, 0.26, 0.14, 6, BARK_BIRCH), canopy(c, 1, 2.3)]),
          finish([trunk(8.5, 0.26, 0.14, 4, BARK_BIRCH), canopy(mid, 0, 2.3)]),
          finish([canopy(far, 0, 2.3)]),
        ],
        height: 12.5,
      };
    }
    case TreeSpecies.Pine: {
      const leaf: RGB = [0.05, 0.125, 0.065];
      return {
        lods: [
          finish([trunk(5, 0.36, 0.2, 6, BARK), conifer(5, 16, 3.4, 10, leaf, 0.9)]),
          finish([trunk(5, 0.36, 0.2, 4, BARK), conifer(3, 16, 3.4, 6, leaf, 0.9)]),
          finish([conifer(1, 16, 3.0, 5, leaf, 0.9)]),
        ],
        height: 16.5,
      };
    }
    case TreeSpecies.Poplar: {
      const leaf: RGB = [0.12, 0.215, 0.055];
      const blobs: Blob[] = [
        { x: 0, y: 5.2, z: 0, rx: 1.7, ry: 2.6, rz: 1.7 },
        { x: 0.2, y: 8.6, z: -0.1, rx: 1.9, ry: 3.0, rz: 1.9 },
        { x: -0.1, y: 12.2, z: 0.15, rx: 1.6, ry: 2.9, rz: 1.6 },
        { x: 0, y: 15.2, z: 0, rx: 1.05, ry: 2.2, rz: 1.05 },
      ];
      const c: Canopy = { blobs, cy: 10, halfH: 7.2, radius: 2.1, leaf };
      const far: Canopy = { ...c, blobs: [{ x: 0, y: 10, z: 0, rx: 1.9, ry: 7.2, rz: 1.9 }] };
      const mid: Canopy = { ...c, blobs: [blobs[0]!, { x: 0, y: 10.2, z: 0, rx: 1.9, ry: 4.4, rz: 1.9 }, blobs[3]!] };
      return {
        lods: [
          finish([trunk(4, 0.3, 0.2, 6, BARK), canopy(c, 1, 3.7)]),
          finish([trunk(4, 0.3, 0.2, 4, BARK), canopy(mid, 0, 3.7)]),
          finish([canopy(far, 0, 3.7)]),
        ],
        height: 17.5,
      };
    }
  }
}
