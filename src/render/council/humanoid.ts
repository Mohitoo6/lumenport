import {
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  BoxGeometry,
  ConeGeometry,
  DoubleSide,
  type BufferGeometry,
  type Material,
} from 'three';
import type { Looks } from '../../game/council/ministries';

/**
 * A seated, stylised human built from simple shapes and driven by joint rotations: no
 * skinned mesh or animation files. Proportions are an adult at about 1.75 m standing.
 * The figure faces local +z; the seat is at the origin.
 */

export interface Rig {
  root: Group;
  hips: Group;
  spine: Group;
  neck: Group;
  head: Group;
  shoulderL: Group;
  shoulderR: Group;
  elbowL: Group;
  elbowR: Group;
  wristL: Group;
  wristR: Group;
  mouth: Mesh;
  eyes: Mesh[];
  lids: Mesh[];
}

const SEAT_H = 0.48;

function mesh(geo: BufferGeometry, m: Material, cast = true): Mesh {
  const o = new Mesh(geo, m);
  o.castShadow = cast;
  o.receiveShadow = true;
  return o;
}

function col(hex: string, k = 1): Color {
  return new Color(hex).multiplyScalar(k);
}

/** A limb segment hanging from a joint along local -y. */
function limb(parent: Group, length: number, radius: number, m: Material): Group {
  const joint = new Group();
  parent.add(joint);
  const seg = mesh(new CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 4, 10), m);
  seg.position.y = -length / 2;
  joint.add(seg);
  return joint;
}

export function buildHuman(looks: Looks, accent: string): Rig {
  const skin = new MeshStandardMaterial({ color: col(looks.skin), roughness: 0.62 });
  const suit = new MeshStandardMaterial({ color: col(looks.outfit, 1.1), roughness: 0.72 });
  const shirt = new MeshStandardMaterial({ color: new Color(0.92, 0.9, 0.86), roughness: 0.6 });
  const tie = new MeshStandardMaterial({ color: col(accent, 0.8), roughness: 0.45 });
  const hairMat = new MeshStandardMaterial({ color: col(looks.hair), roughness: 0.75 });
  const trousers = new MeshStandardMaterial({ color: new Color(0.06, 0.065, 0.075), roughness: 0.7 });
  const shoe = new MeshStandardMaterial({ color: new Color(0.03, 0.025, 0.02), roughness: 0.35 });
  const dark = new MeshStandardMaterial({ color: new Color(0.05, 0.035, 0.03), roughness: 0.5 });
  const white = new MeshStandardMaterial({ color: new Color(0.95, 0.95, 0.93), roughness: 0.3 });
  const lip = new MeshStandardMaterial({ color: col(looks.skin, 0.55), roughness: 0.5 });
  const scarfMat = new MeshStandardMaterial({ color: col(accent, 0.55), roughness: 0.8, side: DoubleSide });
  const lapel = new MeshStandardMaterial({ color: col(looks.outfit, 0.85), roughness: 0.6 });

  const root = new Group();
  const hips = new Group();
  hips.position.y = SEAT_H + 0.06;
  root.add(hips);

  // Seated legs: thighs forward, shins down.
  for (const side of [-1, 1]) {
    const thigh = mesh(new CapsuleGeometry(0.085, 0.3, 4, 10), trousers);
    thigh.rotation.x = Math.PI / 2;
    thigh.position.set(side * 0.11, 0, 0.22);
    hips.add(thigh);
    const shin = mesh(new CapsuleGeometry(0.07, 0.36, 4, 10), trousers);
    shin.position.set(side * 0.11, -0.26, 0.44);
    hips.add(shin);
    const foot = mesh(new BoxGeometry(0.1, 0.07, 0.24), shoe);
    foot.position.set(side * 0.11, -0.5, 0.5);
    hips.add(foot);
  }
  const pelvis = mesh(new CapsuleGeometry(0.15, 0.12, 4, 12), trousers);
  pelvis.rotation.z = Math.PI / 2;
  pelvis.scale.set(1, 1, 0.8);
  hips.add(pelvis);

  // Torso.
  const spine = new Group();
  spine.position.y = 0.06;
  hips.add(spine);
  const chest = mesh(new CapsuleGeometry(0.17, 0.34, 6, 14), suit);
  chest.scale.set(1.18, 1, 0.78);
  chest.position.y = 0.27;
  spine.add(chest);
  // Shirt and tie in the jacket's V.
  const shirtV = mesh(new ConeGeometry(0.075, 0.26, 3), shirt, false);
  shirtV.rotation.set(Math.PI, 0, 0);
  shirtV.scale.set(1, 1, 0.25);
  shirtV.position.set(0, 0.47, 0.125);
  spine.add(shirtV);
  // Jacket lapels either side of the shirt.
  for (const side of [-1, 1]) {
    const l = mesh(new BoxGeometry(0.045, 0.24, 0.014), lapel, false);
    l.position.set(side * 0.06, 0.46, 0.128);
    l.rotation.set(-0.15, 0, side * 0.32);
    spine.add(l);
  }
  if (looks.hairStyle !== 'scarf') {
    const tieMesh = mesh(new BoxGeometry(0.035, 0.22, 0.012), tie, false);
    tieMesh.position.set(0, 0.42, 0.142);
    tieMesh.rotation.x = -0.12;
    spine.add(tieMesh);
  }

  // Neck and head.
  const neck = new Group();
  neck.position.y = 0.6;
  spine.add(neck);
  const neckMesh = mesh(new CylinderGeometry(0.048, 0.055, 0.1, 10), skin);
  neckMesh.position.y = 0.03;
  neck.add(neckMesh);
  const head = new Group();
  head.position.y = 0.1;
  neck.add(head);
  const skull = mesh(new SphereGeometry(0.1, 20, 16), skin);
  skull.scale.set(0.95, 1.18, 1.0);
  skull.position.y = 0.1;
  head.add(skull);
  for (const side of [-1, 1]) {
    const ear = mesh(new SphereGeometry(0.022, 8, 6), skin, false);
    ear.scale.set(0.5, 1, 0.8);
    ear.position.set(side * 0.094, 0.1, 0);
    head.add(ear);
  }
  const nose = mesh(new ConeGeometry(0.016, 0.045, 8), skin, false);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.09, 0.1);
  head.add(nose);

  // Eyes with lids for blinking, brows, mouth.
  const eyes: Mesh[] = [];
  const lids: Mesh[] = [];
  for (const side of [-1, 1]) {
    const eye = mesh(new SphereGeometry(0.014, 10, 8), white, false);
    eye.position.set(side * 0.036, 0.125, 0.084);
    head.add(eye);
    const pupil = mesh(new SphereGeometry(0.008, 8, 6), dark, false);
    pupil.position.set(0, 0, 0.009);
    eye.add(pupil);
    eyes.push(eye);
    const lid = mesh(new SphereGeometry(0.0155, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), skin, false);
    lid.position.copy(eye.position);
    lid.scale.y = 0.15;
    head.add(lid);
    lids.push(lid);
    const brow = mesh(new BoxGeometry(0.036, 0.006, 0.01), hairMat, false);
    brow.position.set(side * 0.037, 0.152, 0.088);
    brow.rotation.z = -side * 0.08;
    head.add(brow);
  }
  const mouth = mesh(new SphereGeometry(0.022, 12, 6), lip, false);
  mouth.scale.set(1, 0.12, 0.4);
  mouth.position.set(0, 0.046, 0.099);
  head.add(mouth);

  if (looks.glasses) {
    const frame = new MeshStandardMaterial({ color: new Color(0.08, 0.08, 0.09), roughness: 0.3, metalness: 0.6 });
    for (const side of [-1, 1]) {
      const ring = mesh(new TorusGeometry(0.022, 0.003, 6, 18), frame, false);
      ring.position.set(side * 0.036, 0.125, 0.1);
      head.add(ring);
    }
    const bridge = mesh(new BoxGeometry(0.03, 0.004, 0.004), frame, false);
    bridge.position.set(0, 0.128, 0.104);
    head.add(bridge);
  }
  if (looks.beard) {
    const beard = mesh(new SphereGeometry(0.104, 24, 12, -Math.PI * 0.1, Math.PI * 1.2, Math.PI * 0.58, Math.PI * 0.42), hairMat, false);
    beard.scale.set(1, 1.15, 1.02);
    beard.position.set(0, 0.11, 0.004);
    const moustache = mesh(new CapsuleGeometry(0.009, 0.04, 4, 8), hairMat, false);
    moustache.rotation.z = Math.PI / 2;
    moustache.position.set(0, 0.066, 0.097);
    head.add(moustache);
    head.add(beard);
  }

  // Hair.
  const cap = (scaleY: number, from = 0, to = Math.PI * 0.46): Mesh => {
    const h = mesh(new SphereGeometry(0.108, 20, 12, 0, Math.PI * 2, from, to), hairMat);
    h.scale.set(1, scaleY, 1.05);
    h.position.set(0, 0.12, -0.012);
    // Tipped back: the hairline sits above the brows and the hair covers the back of the head.
    h.rotation.x = -0.5;
    return h;
  };
  switch (looks.hairStyle) {
    case 'short':
      head.add(cap(1.12));
      break;
    case 'side': {
      const h = cap(1.14);
      h.rotation.z = 0.12;
      head.add(h);
      break;
    }
    case 'long': {
      head.add(cap(1.15));
      const back = mesh(new CapsuleGeometry(0.09, 0.2, 4, 12), hairMat);
      back.scale.set(1.15, 1, 0.55);
      back.position.set(0, 0.0, -0.06);
      head.add(back);
      break;
    }
    case 'bun': {
      head.add(cap(1.12));
      const bun = mesh(new SphereGeometry(0.045, 12, 10), hairMat);
      bun.position.set(0, 0.2, -0.08);
      head.add(bun);
      break;
    }
    case 'bald': {
      const fringe = mesh(new TorusGeometry(0.095, 0.022, 8, 20, Math.PI * 1.2), hairMat);
      fringe.rotation.set(Math.PI / 2, 0, Math.PI * -0.1 + Math.PI);
      fringe.position.set(0, 0.09, -0.01);
      head.add(fringe);
      break;
    }
    case 'curly': {
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        const curl = mesh(new SphereGeometry(0.04, 8, 6), hairMat);
        curl.position.set(Math.cos(a) * 0.08, 0.19 + Math.sin(k * 1.7) * 0.015, Math.sin(a) * 0.075 - 0.01);
        head.add(curl);
      }
      head.add(cap(1.15));
      break;
    }
    case 'scarf': {
      // Covers the head and sides, open at the face (phi = pi/2 faces +z).
      const hood = mesh(new SphereGeometry(0.122, 20, 14, Math.PI * 0.78, Math.PI * 1.44, 0, Math.PI * 0.82), scarfMat);
      hood.scale.set(1, 1.15, 1.02);
      hood.position.set(0, 0.11, -0.01);
      head.add(hood);
      const drape = mesh(new CylinderGeometry(0.1, 0.16, 0.16, 18, 1, true), scarfMat);
      drape.scale.set(1.05, 1, 0.85);
      drape.position.set(0, -0.04, -0.012);
      head.add(drape);
      break;
    }
  }

  // Arms: shoulder -> elbow -> wrist, hanging along -y.
  const arm = (side: number): [Group, Group, Group] => {
    const shoulder = new Group();
    shoulder.position.set(side * 0.215, 0.5, 0);
    spine.add(shoulder);
    const pad = mesh(new SphereGeometry(0.066, 12, 10), suit);
    pad.scale.set(1, 0.8, 1);
    shoulder.add(pad);
    const upper = limb(shoulder, 0.28, 0.053, suit);
    const elbow = new Group();
    elbow.position.y = -0.28;
    upper.add(elbow);
    const fore = limb(elbow, 0.25, 0.046, suit);
    const wrist = new Group();
    wrist.position.y = -0.25;
    fore.add(wrist);
    const cuff = mesh(new CylinderGeometry(0.045, 0.043, 0.018, 12), shirt, false);
    cuff.position.y = 0.012;
    wrist.add(cuff);
    const hand = mesh(new SphereGeometry(0.048, 12, 10), skin);
    hand.scale.set(0.7, 1.15, 0.45);
    hand.position.y = -0.05;
    wrist.add(hand);
    // Thumb on the inner side of the hand.
    const thumb = mesh(new CapsuleGeometry(0.012, 0.03, 3, 6), skin, false);
    thumb.position.set(-side * 0.03, -0.035, -0.012);
    thumb.rotation.z = side * 0.6;
    wrist.add(thumb);
    // Upper arm hangs into the shoulder pad.
    upper.position.y = 0;
    return [shoulder, elbow, wrist];
  };
  const [shoulderL, elbowL, wristL] = arm(1);
  const [shoulderR, elbowR, wristR] = arm(-1);

  return { root, hips, spine, neck, head, shoulderL, shoulderR, elbowL, elbowR, wristL, wristR, mouth, eyes, lids };
}
