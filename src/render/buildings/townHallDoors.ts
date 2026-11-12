import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Vector3 } from 'three';
import { CELL } from '../../core/constants';
import { FacilityKind } from '../../sim/facilities';
import { FACING_DX, FACING_DY, type Building } from '../../sim/zoning/zones';
import { TOWN_HALL_DOOR } from './facilities';

/** World placement of the town hall's front doors. */
export interface DoorFrame {
  /** Centre of the doorway at floor level. */
  x: number;
  y: number;
  z: number;
  /** Unit vector pointing out of the building, through the doors. */
  outX: number;
  outZ: number;
}

export function townHallOf(buildings: ReadonlyArray<Building | null>): Building | null {
  return buildings.find((b) => b && b.kind === FacilityKind.TownHall && b.progress >= 1) ?? null;
}

export function doorFrame(b: Building): DoorFrame {
  const zx = FACING_DX[b.facing]!;
  const zz = FACING_DY[b.facing]!;
  const cx = (b.x + b.w / 2) * CELL;
  const cz = (b.y + b.h / 2) * CELL;
  return { x: cx + zx * TOWN_HALL_DOOR.z, y: b.baseY + TOWN_HALL_DOOR.y, z: cz + zz * TOWN_HALL_DOOR.z, outX: zx, outZ: zz };
}

/**
 * The town hall's two door leaves, hinged at the sides of the doorway, and the warm light
 * from the hall behind them. `setOpen(0..1)` swings them inward.
 */
export class TownHallDoors {
  readonly group = new Group();
  private readonly left = new Group();
  private readonly right = new Group();
  private readonly glow: Mesh;
  private readonly glowMat = new MeshBasicMaterial({ color: new Color(1, 0.72, 0.4), transparent: true, opacity: 0, depthWrite: false });
  private open = 0;

  constructor() {
    const { width, height } = TOWN_HALL_DOOR;
    const wood = new MeshStandardMaterial({ color: new Color(0.16, 0.08, 0.04), roughness: 0.45, metalness: 0.05 });
    const brass = new MeshStandardMaterial({ color: new Color(0.9, 0.68, 0.3), roughness: 0.3, metalness: 1 });
    const leafW = width / 2;
    for (const [hinge, sign] of [
      [this.left, 1],
      [this.right, -1],
    ] as const) {
      const leaf = new Mesh(new BoxGeometry(leafW, height, 0.12), wood);
      leaf.position.set((sign * leafW) / 2, height / 2, 0);
      leaf.castShadow = true;
      hinge.add(leaf);
      // Raised panels and a brass handle.
      for (const py of [height * 0.28, height * 0.7]) {
        const panel = new Mesh(new BoxGeometry(leafW * 0.62, height * 0.3, 0.05), wood);
        panel.position.set((sign * leafW) / 2, py, 0.07);
        hinge.add(panel);
      }
      const handle = new Mesh(new BoxGeometry(0.06, 0.32, 0.08), brass);
      handle.position.set(sign * (leafW - 0.18), height * 0.48, 0.1);
      hinge.add(handle);
      hinge.position.set(-sign * (width / 2), 0, 0);
      this.group.add(hinge);
    }
    this.glow = new Mesh(new PlaneGeometry(width, height), this.glowMat);
    this.glow.position.set(0, height / 2, -1.15);
    this.group.add(this.glow);
    this.group.visible = false;
  }

  /** Places the doors on a town hall, or hides them if there is none. */
  attach(b: Building | null): void {
    if (!b) {
      this.group.visible = false;
      return;
    }
    const f = doorFrame(b);
    this.group.position.set(f.x, f.y, f.z);
    // Local +z must point out of the building.
    this.group.rotation.set(0, Math.atan2(f.outX, f.outZ), 0);
    this.group.visible = true;
    this.setOpen(this.open);
  }

  /** 0 closed, 1 open (each leaf swings 80 degrees inward). */
  setOpen(t: number): void {
    this.open = t;
    const e = t * t * (3 - 2 * t);
    const a = e * (Math.PI * 0.45);
    this.left.rotation.y = a;
    this.right.rotation.y = -a;
    // Warm lamplight from the hall, bright enough to bloom a little but not blow out.
    this.glowMat.opacity = Math.min(1, e * 1.3);
    this.glowMat.color.setRGB(0.55 + e * 0.75, 0.32 + e * 0.42, 0.14 + e * 0.16);
  }

  worldPosition(out: Vector3): Vector3 {
    return out.copy(this.group.position);
  }
}
