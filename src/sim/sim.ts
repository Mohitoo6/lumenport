import { CELL, DAYS_PER_MONTH, MAP, TICKS_PER_DAY } from '../core/constants';
import { Rng } from '../core/rng';
import { Emitter } from '../core/events';
import { OK, fail, type Command, type CommandResult } from './commands';
import { demolishEdge, executePlan, executeUpgrade, planRoad, planUpgrade, type UpgradePlan, type RoadChange, type RoadPlan, type RoadRequest } from './roads/plan';
import { LOAN_TIERS, loanPayment, projectBudget } from './economy/budget';
import { economyStep, growthRateFor } from './economy/economy';
import { FacilityKind, findTownHallSite, isLandmark, planFacility, type FacilityPlan } from './facilities';
import { ROAD_SPECS } from './roads/types';
import { Fields } from './fields/fields';
import { cellMinHeight } from './map/terrain';
import { Traffic } from './traffic/traffic';
import { POWERED, WATERED, computeUtilities, newNetworks, type Networks } from './utilities/network';
import { MAX_DEPTH, frontageOf, reachesRoad } from './zoning/lots';
import { zoneAlongCells } from './zoning/along';
import { roadAngle } from './zoning/orient';
import { FACING_DX, FACING_DY } from './zoning/zones';
import { createState, type GameState } from './state';
import { advanceConstruction, buildFrontier, growthStep, lotRect, removeBuilding, spawnBuilding, type GrowthResult } from './zoning/growth';
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
  /** A month's budget was settled; the report is in state.report. */
  monthPassed: number;
  /** A command was applied (or refused). */
  command: { cmd: Command; result: CommandResult };
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
  /** How eagerly zoned land develops in sandbox mode, 0..1. Otherwise demand decides. */
  growthRate = 0.7;
  /** Road networks and their power and water balance. Derived, never saved. */
  readonly net: Networks = newNetworks();
  /** Pollution, crime, land value, happiness and service coverage. Derived, never saved. */
  readonly fields = new Fields();
  /** Vehicles on the roads. Derived, never saved. */
  readonly traffic: Traffic;
  private netDirty = true;
  private utilDirty = true;
  private readonly rates: number[] = [0, 0, 0, 0];
  /** Cached list of cells where a building could start; null means it must be rebuilt. */
  private frontier: number[] | null = null;
  private readonly changedIds: number[] = [];

  constructor(state: GameState) {
    this.state = state;
    this.traffic = new Traffic(state);
    this.traffic.reset(state);
  }

  static create(seed: number, cityName?: string): Sim {
    return new Sim(createState(seed, cityName));
  }

  replaceState(state: GameState): void {
    this.state = state;
    this.frontier = null;
    this.netDirty = true;
    this.utilDirty = true;
    this.traffic.reset(state);
    this.refreshUtilities();
    this.refreshFields();
    this.events.emit('stateReplaced', null);
  }

  /** Advances the simulation by one fixed step. */
  tick(): void {
    const s = this.state;
    s.tick++;

    const changed = this.changedIds;
    changed.length = 0;
    const building = s.constructing.length;
    advanceConstruction(s, changed);
    if (s.constructing.length !== building) this.utilDirty = true;
    const newDay = s.tick % TICKS_PER_DAY === 0;
    if (s.tick % 8 === 0) {
      if (this.utilDirty || newDay) this.refreshUtilities();
      this.grow(changed);
    }
    if (changed.length > 0) this.events.emit('buildingsChanged', { changed: changed.slice(), removed: [] });

    this.traffic.tick();

    if (newDay) {
      const day = s.tick / TICKS_PER_DAY;
      s.stats.congestion = this.traffic.congestion;
      s.stats.vehicles = this.traffic.count;
      // The layers change slowly; every few days is plenty.
      if (day % 4 === 0) this.refreshFields();
      economyStep(s.buildings, s.tax, s.stats);
      this.events.emit('dayPassed', day);
      if (day % DAYS_PER_MONTH === 0) this.settleMonth(day / DAYS_PER_MONTH);
    }
  }

  /** Recomputes the data layers and the city's average happiness. */
  refreshFields(): void {
    const s = this.state;
    const st = s.stats;
    const labor = st.population * 0.55;
    const unemployment = labor > 0 ? Math.max(0, 1 - st.employed / labor) : 0;
    st.happiness = this.fields.update(s.buildings, s.roads, s.roadCell, s.heights, this.traffic.density, s.tax, unemployment, st.congestion);
  }

  /** Recomputes power and water on every road network. */
  refreshUtilities(): void {
    const s = this.state;
    computeUtilities(s.buildings, s.roadCell, this.net, this.netDirty, Math.floor(s.tick / TICKS_PER_DAY), s.stats);
    // Sandbox cities need no plants: everything counts as connected.
    if (s.sandbox) for (const b of s.buildings) if (b) b.flags |= POWERED | WATERED;
    this.netDirty = false;
    this.utilDirty = false;
  }

  private settleMonth(month: number): void {
    const s = this.state;
    projectBudget(s.buildings, s.roads, s.tax, s.loans, s.stats, s.report, s.policies);
    if (!s.sandbox) s.funds += s.report.net;
    for (let i = s.loans.length - 1; i >= 0; i--) {
      if (--s.loans[i]!.monthsLeft <= 0) s.loans.splice(i, 1);
    }
    this.events.emit('monthPassed', month);
  }

  /** True if the street in front of cell (i, j) has spare power and water. */
  readonly served = (i: number, j: number): boolean => {
    const f: number = frontageOf(this.state, i, j);
    if (f < 0) return false;
    const c = this.net.comp[(j + FACING_DY[f as 0]!) * MAP + i + FACING_DX[f as 0]!]!;
    if (c < 0) return false;
    const n = this.net;
    return n.powerSupply[c]! > n.powerDemand[c]! && n.waterSupply[c]! > n.waterDemand[c]!;
  };

  /** Takes money for a build. Returns false (and takes nothing) if the city cannot pay. */
  private charge(cost: number): boolean {
    const s = this.state;
    if (s.sandbox) return true;
    if (s.funds < cost) return false;
    s.funds -= cost;
    return true;
  }

  /** True if a planned road would run over the town hall. */
  private roadHitsLandmark(plan: RoadPlan): boolean {
    const s = this.state;
    const hw = ROAD_SPECS[plan.type].width / 2;
    const steps = Math.max(2, Math.ceil(plan.length / 3));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const u = 1 - t;
      const x = u * u * plan.ax + 2 * u * t * plan.cx + t * t * plan.bx;
      const z = u * u * plan.az + 2 * u * t * plan.cz + t * t * plan.bz;
      for (let j = Math.floor((z - hw) / CELL); j <= Math.floor((z + hw) / CELL); j++) {
        for (let i = Math.floor((x - hw) / CELL); i <= Math.floor((x + hw) / CELL); i++) {
          if (i < 0 || j < 0 || i >= MAP || j >= MAP) continue;
          if (Math.hypot((i + 0.5) * CELL - x, (j + 0.5) * CELL - z) >= hw) continue;
          const id = s.buildingCell[j * MAP + i]!;
          if (id >= 0 && isLandmark(s.buildings[id]?.kind ?? 0)) return true;
        }
      }
    }
    return false;
  }

  /** Dry run of rebuilding a road segment as another type. */
  planUpgrade(edge: number, road: number): UpgradePlan {
    return planUpgrade(this.state.roads, this.state, edge, road);
  }

  /** Dry run of placing a facility centred on a cell. */
  planFacility(kind: number, i: number, j: number): FacilityPlan {
    return planFacility(this.state, kind, i, j);
  }

  private grow(changed: number[]): void {
    const s = this.state;
    this.frontier ??= buildFrontier(s);
    const rng = new Rng(s.rng);
    const result: GrowthResult = { spawned: [], upgraded: [] };
    const rates = this.rates;
    for (let t = 1; t <= 3; t++) rates[t] = s.sandbox ? this.growthRate : growthRateFor(s.stats.demand[t]!);
    growthStep(s, this.frontier, rng, rates, result, s.sandbox ? undefined : this.served, s.sandbox ? undefined : this.fields.landValue);
    if (result.spawned.length > 0) this.utilDirty = true;
    s.rng = rng.state;
    for (const b of result.spawned) {
      const dir = roadAngle(s.roads, s.roadCell, b);
      if (dir !== undefined) b.dir = dir;
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
    // Zoning that no longer reaches any road (its road was removed) can never be built on.
    const r0x = Math.max(0, x0 - MAX_DEPTH);
    const r0y = Math.max(0, y0 - MAX_DEPTH);
    const r1x = Math.min(MAP - 1, x1 + MAX_DEPTH);
    const r1y = Math.min(MAP - 1, y1 + MAX_DEPTH);
    for (let j = r0y; j <= r1y; j++) {
      for (let i = r0x; i <= r1x; i++) {
        const k = j * MAP + i;
        if (s.zone[k] !== 0 && s.buildingCell[k]! < 0 && !reachesRoad(s, i, j)) {
          s.zone[k] = 0;
          zoned = true;
        }
      }
    }
    if (zoned) this.events.emit('zonesChanged', { x0: r0x, y0: r0y, x1: r1x, y1: r1y });
    if (removed.length > 0) this.events.emit('buildingsChanged', { changed: [], removed });
  }

  /** Dry run of a road: validity, attachment points, length and cost. Changes nothing. */
  planRoad(req: RoadRequest): RoadPlan {
    return planRoad(this.state.roads, this.state.heights, req);
  }

  private roadChanged(change: RoadChange): void {
    this.traffic.reset();
    this.frontier = null;
    this.netDirty = true;
    this.utilDirty = true;
    this.clearUnderRoads(change);
    if (change.terrain) this.events.emit('terrainChanged', change.terrain);
    if (change.trees) this.events.emit('treesChanged', change.trees);
    this.events.emit('roadsChanged', change);
  }

  /** Carries out a player command and announces the outcome. */
  apply(cmd: Command): CommandResult {
    const result = this.run(cmd);
    this.events.emit('command', { cmd, result });
    return result;
  }

  private run(cmd: Command): CommandResult {
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
        if (this.roadHitsLandmark(plan)) return fail('The town hall is in the way');
        if (!this.charge(plan.cost)) return fail('Not enough money');
        this.roadChanged(executePlan(s.roads, s, plan));
        return { ok: true, cost: plan.cost };
      }
      case 'upgradeRoad': {
        const plan = planUpgrade(s.roads, s, cmd.edge, cmd.road);
        if (!plan.ok) return fail(plan.reason);
        if (plan.displaced.some((id) => isLandmark(s.buildings[id]?.kind ?? 0))) return fail('The town hall is in the way');
        if (!this.charge(plan.cost)) return fail('Not enough money');
        this.roadChanged(executeUpgrade(s.roads, s, cmd.edge, cmd.road));
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
        let tooFar = 0;
        for (let j = y0; j <= y1; j++) {
          for (let i = x0; i <= x1; i++) {
            const k = j * MAP + i;
            if (s.zone[k] === cmd.zone || s.roadCell[k]! >= 0) continue;
            if (cmd.zone !== 0 && cellMinHeight(s.heights, i, j) < 0.5) continue;
            if (cmd.zone !== 0 && !reachesRoad(s, i, j)) {
              tooFar++;
              continue;
            }
            // Re-zoning under a building clears it: the land is being put to a new use.
            // The town hall is never zoned over.
            const id = s.buildingCell[k]!;
            if (id >= 0 && isLandmark(s.buildings[id]?.kind ?? 0)) continue;
            if (id >= 0) {
              const b = removeBuilding(s, id);
              if (b) removed.push(b);
            }
            s.zone[k] = cmd.zone;
            painted++;
          }
        }
        if (painted === 0) {
          if (cmd.zone === 0) return fail('Nothing to clear here');
          return fail(tooFar > 0 ? `Zone land within ${MAX_DEPTH} cells of a road` : 'Nothing here can be zoned');
        }
        this.frontier = null;
        this.events.emit('zonesChanged', { x0, y0, x1, y1 });
        if (removed.length > 0) this.events.emit('buildingsChanged', { changed: [], removed });
        return OK;
      }
      case 'zoneAlong': {
        if (cmd.zone < 0 || cmd.zone > 15 || (cmd.zone !== 0 && ((cmd.zone & 3) === 0 || cmd.zone >> 2 === 0))) return fail('Invalid zone');
        const cells = zoneAlongCells(s, cmd.edges, cmd.zone);
        if (cells.length === 0) return fail(cmd.zone === 0 ? 'Nothing to clear along this road' : 'No free land along this road');
        const removed: Building[] = [];
        let x0 = MAP;
        let y0 = MAP;
        let x1 = 0;
        let y1 = 0;
        for (const k of cells) {
          const id = s.buildingCell[k]!;
          if (id >= 0) {
            const b = removeBuilding(s, id);
            if (b) removed.push(b);
          }
          s.zone[k] = cmd.zone;
          const i = k % MAP;
          const j = (k / MAP) | 0;
          if (i < x0) x0 = i;
          if (i > x1) x1 = i;
          if (j < y0) y0 = j;
          if (j > y1) y1 = j;
        }
        this.frontier = null;
        this.events.emit('zonesChanged', { x0, y0, x1, y1 });
        if (removed.length > 0) this.events.emit('buildingsChanged', { changed: [], removed });
        return { ok: true, cost: 0, count: cells.length };
      }
      case 'bulldozeBuilding': {
        if (isLandmark(s.buildings[cmd.id]?.kind ?? 0)) return fail('The town hall cannot be demolished');
        const b = removeBuilding(s, cmd.id);
        if (!b) return fail('No building there');
        this.frontier = null;
        this.utilDirty = true;
        this.events.emit('buildingsChanged', { changed: [], removed: [b] });
        return OK;
      }
      case 'foundTownHall': {
        if (s.buildings.some((b) => b && b.kind === FacilityKind.TownHall)) return fail('The city already has a town hall');
        const site = findTownHallSite(s, MAP >> 1, MAP >> 1);
        if (!site) return fail('No flat land for a town hall');
        const plan = planFacility(s, FacilityKind.TownHall, site.x, site.y);
        const rng = new Rng(s.rng);
        const b = spawnBuilding(s, { x: plan.x, y: plan.y, w: plan.size, h: plan.size, facing: plan.facing }, 0, rng, FacilityKind.TownHall);
        s.rng = rng.state;
        // It stands from the first day.
        b.progress = 1;
        s.constructing = s.constructing.filter((id) => id !== b.id);
        const r = lotRect(b);
        this.frontier = null;
        this.events.emit('terrainChanged', r);
        this.events.emit('treesChanged', r);
        this.events.emit('buildingsChanged', { changed: [b.id], removed: [] });
        return OK;
      }
      case 'placeFacility': {
        if (isLandmark(cmd.kind) && s.buildings.some((b) => b && b.kind === cmd.kind)) return fail('The city already has one');
        const plan = planFacility(s, cmd.kind, cmd.x, cmd.y);
        if (!plan.ok) return fail(plan.reason);
        if (!this.charge(plan.cost)) return fail('Not enough money');
        const rng = new Rng(s.rng);
        const b = spawnBuilding(s, { x: plan.x, y: plan.y, w: plan.size, h: plan.size, facing: plan.facing }, 0, rng, plan.kind);
        s.rng = rng.state;
        // Clear any zoning under it.
        const r = lotRect(b);
        for (let j = b.y; j < b.y + b.h; j++) for (let i = b.x; i < b.x + b.w; i++) s.zone[j * MAP + i] = 0;
        this.frontier = null;
        this.utilDirty = true;
        this.events.emit('zonesChanged', r);
        this.events.emit('terrainChanged', r);
        this.events.emit('treesChanged', r);
        this.events.emit('buildingsChanged', { changed: [b.id], removed: [] });
        return { ok: true, cost: plan.cost };
      }
      case 'setTax': {
        if (cmd.zone < 1 || cmd.zone > 3) return fail('Invalid zone');
        if (!(cmd.rate >= 0 && cmd.rate <= 20)) return fail('Tax must be between 0 and 20%');
        s.tax[cmd.zone] = Math.round(cmd.rate);
        return OK;
      }
      case 'takeLoan': {
        const tier = LOAN_TIERS[cmd.tier];
        if (!tier) return fail('No such loan');
        if (s.loans.some((l) => l.tier === cmd.tier)) return fail('That loan is already taken');
        s.loans.push({ tier: cmd.tier, payment: loanPayment(tier), monthsLeft: tier.months });
        s.funds += tier.amount;
        return OK;
      }
      case 'setSandbox':
        s.sandbox = cmd.on;
        return OK;
      case 'setPolicy': {
        if (cmd.policy !== 'flexHours') return fail('Unknown policy');
        s.policies = { ...(s.policies ?? {}), [cmd.policy]: cmd.on };
        return OK;
      }
    }
  }
}
