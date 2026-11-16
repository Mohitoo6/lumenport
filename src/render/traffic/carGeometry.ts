import { BoxGeometry, BufferAttribute, CylinderGeometry, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type RGB = [number, number, number];

/** Paint is white here and tinted per car; dark parts stay dark under any tint. */
const PAINT: RGB = [1, 1, 1];
const GLASS: RGB = [0.06, 0.08, 0.1];
const TYRE: RGB = [0.025, 0.025, 0.028];
const TRIM: RGB = [0.05, 0.05, 0.055];

/** Box faces come in the order +x, -x, +y, -y, +z, -z with four vertices each. */
function box(w: number, h: number, d: number, x: number, y: number, z: number, faces: RGB | RGB[], shape?: (px: number, py: number, pz: number) => [number, number, number]): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = Array.isArray(faces[0]) ? (faces as RGB[])[Math.floor(i / 4)]! : (faces as RGB);
    col.set(c, i * 3);
    if (shape) {
      const [nx, ny, nz] = shape(pos.getX(i), pos.getY(i), pos.getZ(i));
      pos.setXYZ(i, nx, ny, nz);
    }
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  if (shape) g.computeVertexNormals();
  g.translate(x, y, z);
  return g.toNonIndexed();
}

function wheels(track: number, front: number, rear: number, radius: number): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    for (const z of [front, rear]) {
      const g = new CylinderGeometry(radius, radius, 0.24, 10);
      g.rotateZ(Math.PI / 2);
      g.translate(sx * track, radius, z);
      const col = new Float32Array(g.getAttribute('position').count * 3);
      for (let i = 0; i < col.length; i += 3) col.set(TYRE, i);
      g.setAttribute('color', new BufferAttribute(col, 3));
      g.deleteAttribute('uv');
      out.push(g.toNonIndexed());
    }
  }
  return out;
}

function finish(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts)!;
  g.computeBoundingSphere();
  return g;
}

/** Glass on the four sides, paint on the roof. */
const CABIN: RGB[] = [GLASS, GLASS, PAINT, TRIM, GLASS, GLASS];

/**
 * Three body styles (saloon, SUV, van). Cars face +z, sit on y = 0 and are about 4.4 m
 * long. Simple shapes, but with a separate glasshouse, tapered bonnet and real wheels
 * they read as cars from any game camera distance.
 */
export function buildCars(): BufferGeometry[] {
  const saloon = finish([
    // Body: bonnet and boot drop slightly toward the bumpers.
    box(1.8, 0.58, 4.4, 0, 0.55, 0, PAINT, (x, y, z) => [x * (Math.abs(z) > 2 ? 0.94 : 1), y > 0 && Math.abs(z) > 1.9 ? y - 0.1 : y, z]),
    box(1.62, 0.5, 2.3, 0, 1.09, -0.25, CABIN, (x, y, z) => (y > 0 ? [x * 0.84, y, z * 0.68] : [x, y, z])),
    box(1.84, 0.16, 4.46, 0, 0.3, 0, TRIM),
    ...wheels(0.82, 1.38, -1.38, 0.33),
  ]);
  const suv = finish([
    box(1.9, 0.72, 4.6, 0, 0.72, 0, PAINT, (x, y, z) => [x, y > 0 && z > 2 ? y - 0.14 : y, z]),
    box(1.76, 0.6, 3.0, 0, 1.38, -0.45, CABIN, (x, y, z) => (y > 0 ? [x * 0.9, y, z > 0 ? z * 0.72 : z * 0.94] : [x, y, z])),
    box(1.94, 0.18, 4.66, 0, 0.4, 0, TRIM),
    ...wheels(0.86, 1.45, -1.45, 0.39),
  ]);
  const van = finish([
    box(1.95, 0.75, 5.1, 0, 0.72, 0, PAINT),
    // Cab: glass all round under a painted roof, with a raked windscreen.
    box(1.9, 0.8, 1.7, 0, 1.5, 1.6, CABIN, (x, y, z) => (y > 0 ? [x * 0.92, y, z > 0 ? z - 0.55 : z] : [x, y, z])),
    // Load space: a plain painted box, slightly taller than the cab.
    box(1.95, 1.05, 3.3, 0, 1.62, -0.9, PAINT),
    box(1.99, 0.18, 5.16, 0, 0.4, 0, TRIM),
    ...wheels(0.88, 1.65, -1.6, 0.37),
  ]);
  // A city bus: 11.6 m, a long glass band, doors on the kerb side, a destination sign.
  const DOOR: RGB = [0.1, 0.12, 0.14];
  const SIGN: RGB = [1.6, 1.1, 0.25];
  const bus = finish([
    box(2.5, 2.25, 11.6, 0, 1.55, 0, PAINT),
    // The window band on both sides and the windscreen.
    box(2.52, 0.95, 10.4, 0, 2.05, -0.25, [GLASS, GLASS, PAINT, PAINT, GLASS, GLASS]),
    box(2.3, 1.1, 0.06, 0, 1.95, 5.82, GLASS),
    // Doors on the right (kerb) side.
    box(0.04, 1.75, 1.1, 1.27, 1.35, 3.9, DOOR),
    box(0.04, 1.75, 1.1, 1.27, 1.35, -0.6, DOOR),
    box(1.6, 0.24, 0.05, 0, 2.62, 5.83, SIGN),
    // Roof units and the bumper line.
    box(1.6, 0.28, 3.2, 0, 2.82, -2.6, TRIM),
    box(2.56, 0.26, 11.7, 0, 0.55, 0, TRIM),
    ...wheels(1.05, 3.6, -3.4, 0.5),
  ]);
  return [saloon, suv, van, bus];
}

/** Bus livery, linear RGB: a city red. */
export const BUS_PAINT: RGB = [0.62, 0.06, 0.04];

/** Paint colours, linear RGB. Weighted toward the whites, greys and blacks real traffic has. */
export const CAR_PAINT: RGB[] = [
  [0.78, 0.78, 0.76],
  [0.78, 0.78, 0.76],
  [0.42, 0.44, 0.47],
  [0.16, 0.17, 0.18],
  [0.02, 0.02, 0.024],
  [0.45, 0.03, 0.03],
  [0.03, 0.09, 0.3],
  [0.04, 0.13, 0.07],
  [0.5, 0.43, 0.31],
  [0.72, 0.5, 0.03],
];
