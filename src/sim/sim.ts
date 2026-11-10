import { TICKS_PER_DAY } from '../core/constants';
import { Emitter } from '../core/events';
import { OK, fail, type Command, type CommandResult } from './commands';
import { demolishEdge, executePlan, planRoad, type RoadChange, type RoadPlan, type RoadRequest } from './roads/plan';
import { createState, type GameState } from './state';

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

  constructor(state: GameState) {
    this.state = state;
  }

  static create(seed: number, cityName?: string): Sim {
    return new Sim(createState(seed, cityName));
  }

  replaceState(state: GameState): void {
    this.state = state;
    this.events.emit('stateReplaced', null);
  }

  /** Advances the simulation by one fixed step. */
  tick(): void {
    const s = this.state;
    s.tick++;
    if (s.tick % TICKS_PER_DAY === 0) this.events.emit('dayPassed', s.tick / TICKS_PER_DAY);
  }

  /** Dry run of a road: validity, attachment points, length and cost. Changes nothing. */
  planRoad(req: RoadRequest): RoadPlan {
    return planRoad(this.state.roads, this.state.heights, req);
  }

  private roadChanged(change: RoadChange): void {
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
    }
  }
}
