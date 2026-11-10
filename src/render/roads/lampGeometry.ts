import { BoxGeometry, CylinderGeometry, QuadraticBezierCurve3, SphereGeometry, TubeGeometry, Vector3, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Height of the light source above the sidewalk. Used for night glow placement. */
export const LAMP_HEIGHT = 7.6;
/** How far the head reaches over the road from the pole. */
export const LAMP_REACH = 2.1;

/**
 * A cobra-head street lamp: tapered pole on a base, a swept arm and a luminaire. Returns
 * the painted metal body and the lens separately so the lens can glow at night. The arm
 * points along local +Z.
 */
export function buildLamp(): { body: BufferGeometry; lens: BufferGeometry } {
  const parts: BufferGeometry[] = [];
  const base = new CylinderGeometry(0.16, 0.2, 0.55, 8);
  base.translate(0, 0.275, 0);
  parts.push(base);
  const pole = new CylinderGeometry(0.06, 0.1, 7.2, 8);
  pole.translate(0, 0.5 + 3.6, 0);
  parts.push(pole);
  const curve = new QuadraticBezierCurve3(new Vector3(0, 7.6, 0), new Vector3(0, 8.15, 0.35), new Vector3(0, 7.95, 1.55));
  parts.push(new TubeGeometry(curve, 8, 0.05, 6, false));
  const head = new BoxGeometry(0.34, 0.14, 0.8);
  // Taper the head toward its tip so it reads as a luminaire, not a brick.
  const hp = head.getAttribute('position');
  for (let i = 0; i < hp.count; i++) {
    const z = hp.getZ(i);
    const k = z > 0 ? 0.62 : 1;
    hp.setX(i, hp.getX(i) * k);
    if (hp.getY(i) > 0) hp.setY(i, hp.getY(i) * (z > 0 ? 0.5 : 1));
  }
  head.computeVertexNormals();
  head.translate(0, 7.93, 1.85);
  parts.push(head);
  const body = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))!;
  body.computeBoundingSphere();

  const lens = new SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  lens.scale(0.7, 0.35, 1.6);
  lens.translate(0, 7.87, 1.9);
  lens.computeBoundingSphere();
  return { body, lens };
}
