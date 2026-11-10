import { CELL, MAP, TICKS_PER_DAY } from '../core/constants';
import { Rng } from '../core/rng';
import { Emitter } from '../core/events';
import { OK, fail, type Command, type CommandResult } from './commands';
import { demolishEdge, executePlan, planRoad, type RoadChange, type RoadPlan, type RoadRequest } from './roads/plan';
import { cellMinHeight } from './map/terrain';
import { createState, type GameState } from './state';
import { advanceConstruction, buildFrontier, growthStep, lotRect, removeBuilding, type GrowthResult } from './zoning/growth';
import type { Building } from './zoning/zones';

export interface CellRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type SimEvents = {
  /** Terrain heights changed inside this vertex rectangle. */
  terrainChanged: CellRect;
  /** Tree bytes changed inside this cell rectangle. */
  treesChanged: CellRect;
  /** Roads were added, split or removed. */
  roadsChanged: RoadChange;
  /** Zone codes changed inside this cell rectangle. */
  zonesChanged: CellRect;
  /** Buildings appeared, changed stage or level (`changed`), or were removed. */
  buildingsChanged: { changed: number[]; removed: Building[] };
  speedChanged: number;
  dayPassed: number;
  /** A whole new state was installed (new game or load). */
  stateReplaced: null;
};

/**
 * The simulation. Pure TypeScript: no DOM, no three.js (enforced by tsconfig.sim.json).
 * State changes only through `apply` (player commands) and `tick` (time).
 */
export class Sim {
  readonly events = new Emitter<SimEvents>();
  state: GameState;
  /** How eagerly zoned land develops, 0..1. Phase 4 drives this from demand. */
  growthRate = 0.7;
  /** Cached list of cells where a building could start; null means it must be rebuilt. */
  private frontier: number[] | null = null;
  private readonly changedIds: number[] = [];

  constructor(state: GameState) {
    this.state = state;
  }

  static create(seed: number, cityName?: string): Sim {
    return new Sim(createState(seed, cityName));
  }

  replaceState(state: GameState): void {
    this.state = state;
    this.frontier = null;
    this.events.emit('stateReplaced', null);
  }

  /** Advances the simulation by one fixed step. */
  tick(): void {
    const s = this.state;
    s.tick++;

    const changed = this.changedIds;
    changed.length = 0;
    advanceConstruction(s, changed);
    if (s.tick % 8 === 0) this.grow(changed);
    if (changed.length > 0) this.events.emit('buildingsChanged', { changed: changed.slice(), removed: [] });

    if (s.tick % TICKS_PER_DAY === 0) this.events.emit('dayPassed', s.tick / TICKS_PER_DAY);
  }

  private grow(changed: number[]): void {
    const s = this.state;
    this.frontier ??= buildFrontier(s);
    const rng = new Rng(s.rng);
    const result: GrowthResult = { spawned: [], upgraded: [] };
    growthStep(s, this.frontier, rng, this.growthRate, result);
    s.rng = rng.state;
    for (const b of result.spawned) {
      const r = lotRect(b);
      this.events.emit('terrainChanged', r);
      this.events.emit('treesChanged', r);
      changed.push(b.id);
    }
    for (const b of result.upgraded) changed.push(b.id);
  }

  /** Removes zoning and buildings from cells a road now covers. */
  private clearUnderRoads(change: RoadChange): void {
    const s = this.state;
    if (!(change.x1 >= change.x0)) return;
    const pad = 40;
    const x0 = Math.max(0, Math.floor((change.x0 - pad) / CELL));
    const y0 = Math.max(0, Math.floor((change.z0 - pad) / CELL));
    const x1 = Math.min(MAP - 1, Math.ceil((change.x1 + pad) / CELL));
    const y1 = Math.min(MAP - 1, Math.ceil((change.z1 + pad) / CELL));
    const removed: Building[] = [];
    let zoned = false;
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const k = j * MAP + i;
        if (s.roadCell[k]! < 0) continue;
        if (s.zone[k] !== 0) {
          s.zone[k] = 0;
          zoned = true;
        }
        const id = s.buildingCell[k]!;
        if (id >= 0) {
          const b = removeBuilding(s, id);
          if (b) removed.push(b);
        }
      }
    }
    if (zoned) this.events.emit('zonesChanged', { x0, y0, x1, y1 });
    if (removed.length > 0) this.events.emit('buildingsChanged', { changed: [], removed });
  }

  /** Dry run of a road: validity, attachment points, length and cost. Changes nothing. */
  planRoad(req: RoadRequest): RoadPlan {
    return planRoad(this.state.roads, this.state.heights, req);
  }

  private roadChanged(change: RoadChange): void {
    this.frontier = null;
    this.clearUnderRoads(change);
    if (change.terrain) this.events.emit('terrainChanged', change.terrain);
    if (change.trees) this.events.emit('treesChanged', change.trees);
    this.events.emit('roadsChanged', change);
  }

  apply(cmd: Command): CommandResult {
    const s = this.state;
    switch (cmd.type) {
      case 'setSpeed':
        if (cmd.speed < 0 || cmd.speed > 3) return fail('Invalid speed');
        s.speed = cmd.speed;
        this.events.emit('speedChanged', cmd.speed);
        return OK;
      case 'renameCity': {
        const name = cmd.name.trim();
        if (!name) return fail('Name cannot be empty');
        s.cityName = name.slice(0, 40);
        return OK;
      }
      case 'buildRoad': {
        const plan = planRoad(s.roads, s.heights, cmd);
        if (!plan.ok) return fail(plan.reason);
        this.roadChanged(executePlan(s.roads, s, plan));
        return { ok: true, cost: plan.cost };
      }
      case 'bulldozeRoad': {
        const change = demolishEdge(s.roads, s, cmd.edge);
        if (!change) return fail('No road there');
        this.roadChanged(change);
        return OK;
      }
      case 'zoneRect': {
        const x0 = Math.max(1, Math.min(cmd.x0, cmd.x1));
        const y0 = Math.max(1, Math.min(cmd.y0, cmd.y1));
        const x1 = Math.min(MAP - 2, Math.max(cmd.x0, cmd.x1));
        const y1 = Math.min(MAP - 2, Math.max(cmd.y0, cmd.y1));
        if (x1 < x0 || y1 < y0) return fail('Outside the city limits');
        if (cmd.zone < 0 || cmd.zone > 15 || (cmd.zone !== 0 && ((cmd.zone & 3) === 0 || cmd.zone >> 2 === 0))) return fail('Invalid zone');
        const removed: Building[] = [];
        let painted = 0;
        for (let j = y0; j <= y1; j++) {
          for (let i = x0; i <= x1; i++) {
            const k = j * MAP + i;
            if (s.zone[k] === cmd.zone || s.roadCell[k]! >= 0) continue;
            if (cmd.zone !== 0 && cellMinHeight(s.heights, i, j) < 0.5) continue;
            // Re-zoning under a building clears it: the land is being put to a new use.
            const id = s.buildingCell[k]!;
            if (id >= 0) {
              const b = removeBuilding(s, id);
              if (b) removed.push(b);
            }
            s.zone[k] = cmd.zone;
            painted++;
          }
        }
        if (painted === 0) return fail(cmd.zone === 0 ? 'Nothing to clear here' : 'Nothing here can be zoned');
        this.frontier = null;
        this.events.emit('zonesChanged', { x0, y0, x1, y1 });
        if (removed.length > 0) this.events.emit('buildingsChanged', { changed: [], removed });
        return OK;
      }
      case 'bulldozeBuilding': {
        const b = removeBuilding(s, cmd.id);
        if (!b) return fail('No building there');
        this.frontier = null;
        this.events.emit('buildingsChanged', { changed: [], removed: [b] });
        return OK;
      }
    }
  }
}
