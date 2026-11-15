import { CELL, MAP } from '../../core/constants';
import { emptyReport, projectBudget, LOAN_TIERS, loanPayment, POLICY_COST } from '../../sim/economy/budget';
import { FACILITIES, FacilityKind } from '../../sim/facilities';
import type { Command } from '../../sim/commands';
import { cellMinHeight } from '../../sim/map/terrain';
import { treeCount } from '../../sim/map/trees';
import type { RoadPlan } from '../../sim/roads/plan';
import { ROAD_SPECS, RoadType } from '../../sim/roads/types';
import type { Sim } from '../../sim/sim';
import { reachesRoad } from '../../sim/zoning/lots';
import { ZoneType, zoneCode, zoneType } from '../../sim/zoning/zones';
import {
  buildingCentre,
  describeBuildings,
  describePlace,
  facilityNearEdge,
  metres,
  money,
  nearestFacility,
  nearestHome,
  streetName,
} from './context';
import { baselineOf, feasibility, fiscalLimits, project, type Feasibility, type StateDelta } from './effects';
import type { CityIssue } from './issues';

/** What an option would do to the things ministers care about. Drives who speaks. */
export interface Impact {
  displacedHomes: number;
  displacedResidents: number;
  jobsLost: number;
  /** Closest a new road or building would come to a clinic / school, metres. */
  clinicM: number;
  schoolM: number;
  /** A new polluter (coal plant, industry) near homes. */
  pollutes: boolean;
  treesCleared: number;
  green: boolean;
  zoning: boolean;
  tax: boolean;
  roads: boolean;
  /** Cuts power supply (closing a plant). */
  powerCut: boolean;
}

export interface CouncilOption {
  /** A, B, C... in the order presented. */
  id: string;
  title: string;
  /** One sentence every agent is shown: what this does about the problem. */
  gist: string;
  cost: number;
  /** Change to monthly spending (upkeep, loan payment) or income (negative = more income). */
  monthly: number;
  facts: string[];
  /** Exactly what the game does if the mayor approves this option. */
  actions: Command[];
  impact: Impact;
  /**
   * The state-mutation payload: what approving this changes, measured by running `actions`
   * on a fork of the city. Agents quote it, the guardrails check against it, and the
   * mayor's approval is reconciled with it afterwards.
   */
  effects: StateDelta;
  /** Whether the city can pay for it and the game accepts it, by the game's own rules. */
  feasibility: Feasibility;
  /** Where to look on the map, if anywhere. */
  x?: number;
  z?: number;
}

const NO_IMPACT: Impact = {
  displacedHomes: 0,
  displacedResidents: 0,
  jobsLost: 0,
  clinicM: Infinity,
  schoolM: Infinity,
  pollutes: false,
  treesCleared: 0,
  green: false,
  zoning: false,
  tax: false,
  roads: false,
  powerCut: false,
};

type Draft = Omit<CouncilOption, 'id' | 'effects' | 'feasibility'>;

// ---------------------------------------------------------------------------------------
// Roads

/** Buildings and trees under a straight or curved road plan. */
function underRoad(sim: Sim, plan: RoadPlan): { buildings: number[]; trees: number } {
  const s = sim.state;
  const hw = ROAD_SPECS[plan.type].width / 2;
  const ids = new Set<number>();
  const treeCells = new Set<number>();
  const steps = Math.max(2, Math.ceil(plan.length / 2));
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const u = 1 - t;
    const x = u * u * plan.ax + 2 * u * t * plan.cx + t * t * plan.bx;
    const z = u * u * plan.az + 2 * u * t * plan.cz + t * t * plan.bz;
    const i0 = Math.max(0, Math.floor((x - hw) / CELL));
    const i1 = Math.min(MAP - 1, Math.floor((x + hw) / CELL));
    const j0 = Math.max(0, Math.floor((z - hw) / CELL));
    const j1 = Math.min(MAP - 1, Math.floor((z + hw) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (Math.hypot((i + 0.5) * CELL - x, (j + 0.5) * CELL - z) >= hw) continue;
        const k2 = j * MAP + i;
        const id = s.buildingCell[k2]!;
        if (id >= 0) ids.add(id);
        if (treeCount(s.trees[k2]!) > 0) treeCells.add(k2);
      }
    }
  }
  return { buildings: [...ids], trees: treeCells.size };
}

/** Nearest facility of a kind to any point of a road plan, metres. */
function facilityNearPlan(sim: Sim, kind: FacilityKind, plan: RoadPlan): number {
  let best = Infinity;
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    const u = 1 - t;
    const x = u * u * plan.ax + 2 * u * t * plan.cx + t * t * plan.bx;
    const z = u * u * plan.az + 2 * u * t * plan.cz + t * t * plan.bz;
    best = Math.min(best, nearestFacility(sim, kind, x, z));
  }
  return best;
}

const SIDE = ['east', 'south', 'west', 'north'];

/**
 * A new street parallel to a jammed one, joined to the network at both ends, so traffic
 * has a second way through. Tries several offsets and lengths and keeps the one that
 * costs least in money and homes.
 */
function reliefRoad(sim: Sim, edgeId: number): Draft | null {
  const net = sim.state.roads;
  const e = net.edges[edgeId];
  if (!e || e.curved) return null;
  const a = net.nodes[e.a]!;
  const b = net.nodes[e.b]!;
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const ux = (b.x - a.x) / len;
  const uz = (b.z - a.z) / len;
  const nx = -uz;
  const nz = ux;
  const snap = (v: number): number => Math.round(v / CELL) * CELL;
  let best: { plan: RoadPlan; score: number; under: { buildings: number[]; trees: number }; offset: number; sgn: number } | null = null;
  for (const offset of [56, 64, 72, 88, 104, 120, 152]) {
    for (const sgn of [1, -1]) {
      for (const ext of [0, len * 0.35]) {
        const plan = sim.planRoad({
          road: RoadType.Street,
          ax: snap(a.x - ux * ext + nx * offset * sgn),
          az: snap(a.z - uz * ext + nz * offset * sgn),
          bx: snap(b.x + ux * ext + nx * offset * sgn),
          bz: snap(b.z + uz * ext + nz * offset * sgn),
        });
        if (!plan.ok) continue;
        const joins = plan.vias.filter((v) => v.node >= 0 || v.splitEdge >= 0).length;
        if (joins < 2) continue;
        const under = underRoad(sim, plan);
        const people = describeBuildings(sim, under.buildings);
        const score = plan.cost + people.residents * 350 + people.jobs * 150 + offset * 4;
        if (!best || score < best.score) best = { plan, score, under, offset, sgn };
      }
    }
  }
  if (!best) return null;
  const { plan, under } = best;
  const people = describeBuildings(sim, under.buildings);
  // Which side of the jammed road, as a compass direction.
  const ang = Math.atan2(nz * best.sgn, nx * best.sgn);
  const side = SIDE[((Math.round(ang / (Math.PI / 2)) % 4) + 4) % 4]!;
  const name = streetName(sim, edgeId);
  const clinicM = facilityNearPlan(sim, FacilityKind.Clinic, plan);
  const schoolM = facilityNearPlan(sim, FacilityKind.School, plan);
  const joins = plan.vias.filter((v) => v.node >= 0 || v.splitEdge >= 0).length;
  return {
    title: `New relief street parallel to ${name}`,
    gist: `A second route: a ${Math.round(plan.length)} m street ${best.offset} m ${side} of ${name}, joined to the network at ${joins} points.`,
    cost: plan.cost,
    monthly: Math.round(plan.length * ROAD_SPECS[RoadType.Street].upkeep),
    facts: [
      `A ${Math.round(plan.length)} m two-lane street about ${best.offset} m to the ${side} of ${name}, joining the network at ${joins} points, so drivers get a second route.`,
      under.buildings.length ? `It cuts through existing lots: demolishes ${people.text}.` : 'It runs over open land: no buildings demolished.',
      `Nearest clinic to the new street: ${metres(clinicM)}. Nearest school: ${metres(schoolM)}.`,
      under.trees > 3 ? `Clears trees on ${under.trees} plots.` : 'Clears almost no trees.',
    ],
    actions: [{ type: 'buildRoad', road: RoadType.Street, ax: plan.ax, az: plan.az, bx: plan.bx, bz: plan.bz }],
    impact: {
      ...NO_IMPACT,
      displacedHomes: people.homes,
      displacedResidents: people.residents,
      jobsLost: people.jobs,
      clinicM,
      schoolM,
      treesCleared: under.trees,
      roads: true,
    },
    x: (plan.ax + plan.bx) / 2,
    z: (plan.az + plan.bz) / 2,
  };
}

function widenRoad(sim: Sim, edgeId: number): Draft | null {
  const e = sim.state.roads.edges[edgeId];
  if (!e || e.type !== RoadType.Street) return null;
  const plan = sim.planUpgrade(edgeId, RoadType.Avenue);
  if (!plan.ok) return null;
  const people = describeBuildings(sim, plan.displaced);
  const name = streetName(sim, edgeId);
  const clinicM = facilityNearEdge(sim, FacilityKind.Clinic, e);
  const schoolM = facilityNearEdge(sim, FacilityKind.School, e);
  const extra = Math.round(e.length * (ROAD_SPECS[RoadType.Avenue].upkeep - ROAD_SPECS[RoadType.Street].upkeep));
  return {
    title: `Widen ${name} to a four-lane avenue`,
    gist: `Roughly doubles the capacity of this ${Math.round(e.length)} m segment, and draws more traffic onto it.`,
    cost: plan.cost,
    monthly: extra,
    facts: [
      `Rebuilds this ${Math.round(e.length)} m segment with two lanes each way and a median: roughly double the capacity, and more traffic drawn onto it.`,
      plan.displaced.length ? `The wider road (32 m) takes the front of neighbouring lots: demolishes ${people.text}.` : 'The extra width fits: no buildings demolished.',
      `Nearest clinic to ${name}: ${metres(clinicM)}. Nearest school: ${metres(schoolM)}.`,
    ],
    actions: [{ type: 'upgradeRoad', edge: edgeId, road: RoadType.Avenue }],
    impact: {
      ...NO_IMPACT,
      displacedHomes: people.homes,
      displacedResidents: people.residents,
      jobsLost: people.jobs,
      clinicM,
      schoolM,
      roads: true,
    },
  };
}

function flexHours(sim: Sim): Draft | null {
  if (sim.state.policies?.flexHours) return null;
  return {
    title: 'Staggered office hours (policy)',
    gist: 'Cuts the rush-hour peak by about a third by spreading it out; nothing is built and it can be dropped later.',
    cost: 0,
    monthly: POLICY_COST.flexHours,
    facts: [
      `The city pays employers ${money(POLICY_COST.flexHours)} a month to spread start and finish times.`,
      'Traffic at the height of the morning and evening rush drops by about a third, spread over a longer period; the number of trips stays the same.',
      'Nothing is built or demolished. It can be dropped later.',
    ],
    actions: [{ type: 'setPolicy', policy: 'flexHours', on: true }],
    impact: { ...NO_IMPACT },
  };
}

// ---------------------------------------------------------------------------------------
// Facilities

interface Site {
  i: number;
  j: number;
  x0: number;
  y0: number;
  size: number;
  /** Distance from the target point, metres. */
  dist: number;
  homesM: number;
}

/**
 * Valid places for a facility near (x, z), best first. `spread` keeps chosen sites apart;
 * `awayFromHomes` prefers sites far from housing (for a coal plant).
 */
function sitesFor(sim: Sim, kind: FacilityKind, x: number, z: number, count: number, opts: { awayFromHomes?: boolean; radius?: number } = {}): Site[] {
  const s = sim.state;
  const ci = Math.floor(x / CELL);
  const cj = Math.floor(z / CELL);
  const R = opts.radius ?? 40;
  const found: Site[] = [];
  for (let j = Math.max(2, cj - R); j <= Math.min(MAP - 3, cj + R); j++) {
    for (let i = Math.max(2, ci - R); i <= Math.min(MAP - 3, ci + R); i++) {
      // Only cells close enough for the footprint to touch a road can work.
      const k = j * MAP + i;
      if (s.roadCell[k]! >= 0 || s.buildingCell[k]! >= 0) continue;
      let nearRoad = false;
      for (let d = 1; d <= 3 && !nearRoad; d++) {
        nearRoad = s.roadCell[k - d]! >= 0 || s.roadCell[k + d]! >= 0 || s.roadCell[k - d * MAP]! >= 0 || s.roadCell[k + d * MAP]! >= 0;
      }
      if (!nearRoad) continue;
      const plan = sim.planFacility(kind, i, j);
      if (!plan.ok) continue;
      const px = (plan.x + plan.size / 2) * CELL;
      const pz = (plan.y + plan.size / 2) * CELL;
      found.push({ i, j, x0: plan.x, y0: plan.y, size: plan.size, dist: Math.hypot(px - x, pz - z), homesM: nearestHome(sim, px, pz) });
    }
  }
  const score = (a: Site): number => (opts.awayFromHomes ? a.dist * 0.3 - Math.min(a.homesM, 600) * 2 : a.dist);
  found.sort((a, b) => score(a) - score(b));
  const out: Site[] = [];
  for (const site of found) {
    const overlaps = out.some((o) => site.x0 < o.x0 + o.size + 1 && o.x0 < site.x0 + site.size + 1 && site.y0 < o.y0 + o.size + 1 && o.y0 < site.y0 + site.size + 1);
    if (overlaps) continue;
    out.push(site);
    if (out.length >= count) break;
  }
  return out;
}

function facilityOption(sim: Sim, kind: FacilityKind, sites: Site[], purpose: string): Draft | null {
  if (sites.length === 0) return null;
  const spec = FACILITIES[kind]!;
  const n = sites.length;
  const first = sites[0]!;
  const cx = sites.reduce((a, s) => a + (s.x0 + s.size / 2) * CELL, 0) / n;
  const cz = sites.reduce((a, s) => a + (s.y0 + s.size / 2) * CELL, 0) / n;
  const homesM = Math.min(...sites.map((s) => s.homesM));
  const clinicM = nearestFacility(sim, FacilityKind.Clinic, cx, cz);
  const schoolM = nearestFacility(sim, FacilityKind.School, cx, cz);
  const facts = [
    `${n > 1 ? `${n} × ${spec.name.toLowerCase()}` : `A ${spec.name.toLowerCase()}`} ${describePlace(sim, cx, cz)}${n === 1 ? `, ${Math.round(first.dist)} m from the problem area` : ''}. ${purpose}`,
    `Nearest homes: ${metres(homesM)}.`,
  ];
  if (kind === FacilityKind.CoalPlant) {
    facts.push(`A coal plant is a heavy polluter: nearest clinic ${metres(clinicM)}, nearest school ${metres(schoolM)}.`);
  }
  return {
    title: n > 1 ? `Build ${n} ${spec.name.toLowerCase()}s` : `Build a ${spec.name.toLowerCase()}`,
    gist: `${purpose} Nearest homes ${metres(homesM)}.`,
    cost: spec.cost * n,
    monthly: spec.upkeep * n,
    facts,
    actions: sites.map((s) => ({ type: 'placeFacility', kind, x: s.i, y: s.j }) as Command),
    impact: {
      ...NO_IMPACT,
      pollutes: kind === FacilityKind.CoalPlant && homesM < 500,
      clinicM: kind === FacilityKind.CoalPlant ? clinicM : Infinity,
      schoolM: kind === FacilityKind.CoalPlant ? schoolM : Infinity,
      green: kind === FacilityKind.Park || kind === FacilityKind.WindTurbine || kind === FacilityKind.SolarFarm,
    },
    x: cx,
    z: cz,
  };
}

function powerOptions(sim: Sim, issue: CityIssue): Draft[] {
  const st = sim.state.stats;
  const deficit = Math.max(2, st.powerDemand * 1.25 - st.powerSupply);
  const out: Array<Draft | null> = [];
  const wind = Math.min(6, Math.ceil(deficit / FACILITIES[FacilityKind.WindTurbine]!.power));
  const solar = Math.min(4, Math.ceil(deficit / FACILITIES[FacilityKind.SolarFarm]!.power));
  out.push(facilityOption(sim, FacilityKind.WindTurbine, sitesFor(sim, FacilityKind.WindTurbine, issue.x, issue.z, wind), `Adds ${wind * FACILITIES[FacilityKind.WindTurbine]!.power} MW of clean power.`));
  out.push(facilityOption(sim, FacilityKind.SolarFarm, sitesFor(sim, FacilityKind.SolarFarm, issue.x, issue.z, solar), `Adds ${solar * FACILITIES[FacilityKind.SolarFarm]!.power} MW of clean power.`));
  out.push(facilityOption(sim, FacilityKind.CoalPlant, sitesFor(sim, FacilityKind.CoalPlant, issue.x, issue.z, 1, { awayFromHomes: true, radius: 60 }), `Adds ${FACILITIES[FacilityKind.CoalPlant]!.power} MW: cheap per megawatt, but it pollutes.`));
  return out.filter((d): d is Draft => d !== null);
}

function waterOptions(sim: Sim, issue: CityIssue): Draft[] {
  const st = sim.state.stats;
  const deficit = Math.max(400, st.waterDemand * 1.25 - st.waterSupply);
  const towers = Math.min(4, Math.ceil(deficit / FACILITIES[FacilityKind.WaterTower]!.water));
  const out: Array<Draft | null> = [
    facilityOption(sim, FacilityKind.WaterTower, sitesFor(sim, FacilityKind.WaterTower, issue.x, issue.z, towers), `Adds ${(towers * FACILITIES[FacilityKind.WaterTower]!.water).toLocaleString('en-US')} water units.`),
    facilityOption(sim, FacilityKind.WaterPump, sitesFor(sim, FacilityKind.WaterPump, issue.x, issue.z, 1, { radius: 70 }), `Adds ${FACILITIES[FacilityKind.WaterPump]!.water.toLocaleString('en-US')} water units from the river.`),
  ];
  return out.filter((d): d is Draft => d !== null);
}

/** Two different places for a service building near the people who need it. */
function serviceOptions(sim: Sim, kind: FacilityKind, issue: CityIssue, purpose: string): Draft[] {
  let sites = sitesFor(sim, kind, issue.x, issue.z, 40);
  // Dense districts may have no room close by: look further out.
  if (sites.length < 2) sites = sitesFor(sim, kind, issue.x, issue.z, 40, { radius: 75 });
  const out: Draft[] = [];
  const first = sites[0];
  if (first) {
    const d = facilityOption(sim, kind, [first], purpose);
    if (d) out.push(d);
    // A second, clearly different site.
    const alt = sites.find((s) => Math.hypot((s.x0 - first.x0) * CELL, (s.y0 - first.y0) * CELL) > 120);
    if (alt) {
      const d2 = facilityOption(sim, kind, [alt], purpose);
      if (d2) {
        d2.title = `${d2.title} (alternative site)`;
        out.push(d2);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Pollution

function pollutionOptions(sim: Sim, issue: CityIssue): Draft[] {
  const s = sim.state;
  const f = sim.fields;
  const out: Draft[] = [];
  const parks = sitesFor(sim, FacilityKind.Park, issue.x, issue.z, 3, { radius: 14 });
  const park = facilityOption(sim, FacilityKind.Park, parks, 'A green buffer: raises land value and happiness nearby. It does not remove the source of the pollution.');
  if (park) out.push(park);

  // Re-zone the worst-hit homes for shops: residents move out, pollution exposure ends.
  const worst = s.buildings
    .filter((b) => b && b.kind === 0 && b.progress >= 1 && zoneType(b.zone) === ZoneType.Residential)
    .map((b) => ({ b: b!, p: f.pollution[(b!.y + (b!.h >> 1)) * MAP + b!.x + (b!.w >> 1)]! }))
    .filter((v) => v.p > 0.4)
    .sort((a, b) => b.p - a.p)
    .slice(0, 8);
  if (worst.length > 0) {
    const people = describeBuildings(sim, worst.map((w) => w.b.id));
    out.push({
      title: 'Re-zone the worst-hit homes for shops',
      gist: `Moves ${people.residents} residents out of the worst air instead of cleaning it; shops replace their homes.`,
      cost: 0,
      monthly: 0,
      facts: [
        `Demolishes ${people.text} where pollution is above 40%; shops can grow there instead.`,
        'Ends the exposure for those residents by moving them out, rather than cleaning the air.',
      ],
      actions: worst.map((w) => ({ type: 'zoneRect', x0: w.b.x, y0: w.b.y, x1: w.b.x + w.b.w - 1, y1: w.b.y + w.b.h - 1, zone: zoneCode(ZoneType.Commercial, Math.min(2, (w.b.zone & 3) as 1 | 2 | 3) as 1 | 2) }) as Command),
      impact: { ...NO_IMPACT, displacedHomes: people.homes, displacedResidents: people.residents, zoning: true },
    });
  }

  // Close a coal plant near the polluted homes.
  const coal = s.buildings.find((b) => b && b.kind === FacilityKind.CoalPlant && b.progress >= 1 && Math.hypot(buildingCentre(b).x - issue.x, buildingCentre(b).z - issue.z) < 600);
  if (coal) {
    const st = s.stats;
    const after = st.powerSupply - FACILITIES[FacilityKind.CoalPlant]!.power;
    out.push({
      title: 'Close the coal power plant',
      gist: `Removes the biggest polluter; power supply falls to ${after.toFixed(0)} MW against ${st.powerDemand.toFixed(1)} MW of demand${after < st.powerDemand ? ' (a shortage)' : ''}.`,
      cost: 0,
      monthly: -FACILITIES[FacilityKind.CoalPlant]!.upkeep,
      facts: [
        `Removes the biggest polluter ${describePlace(sim, buildingCentre(coal).x, buildingCentre(coal).z)}.`,
        `Power supply would fall from ${st.powerSupply.toFixed(0)} MW to ${after.toFixed(0)} MW against a demand of ${st.powerDemand.toFixed(1)} MW${after < st.powerDemand ? ': the city would be short of power' : ''}.`,
        `Saves ${money(FACILITIES[FacilityKind.CoalPlant]!.upkeep)} a month in upkeep.`,
      ],
      actions: [{ type: 'bulldozeBuilding', id: coal.id }],
      impact: { ...NO_IMPACT, green: true, powerCut: true },
      x: buildingCentre(coal).x,
      z: buildingCentre(coal).z,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Budget

function budgetOptions(sim: Sim): Draft[] {
  const s = sim.state;
  const out: Draft[] = [];
  const gain = (tax: [number, number, number, number]): number => {
    const now = projectBudget(s.buildings, s.roads, s.tax, s.loans, s.stats, emptyReport(), s.policies, s.metro).income;
    return projectBudget(s.buildings, s.roads, tax, s.loans, s.stats, emptyReport(), s.policies, s.metro).income - now;
  };
  const up = (v: number, by: number): number => Math.min(20, v + by);
  const all: [number, number, number, number] = [0, up(s.tax[1], 2), up(s.tax[2], 2), up(s.tax[3], 2)];
  const g1 = gain(all);
  out.push({
    title: 'Raise all taxes by 2 points',
    gist: `About ${money(g1)} more a month; slows growth in every zone and lowers happiness.`,
    cost: 0,
    monthly: -g1,
    facts: [
      `Rates go to ${all[1]}% / ${all[2]}% / ${all[3]}% (homes / shops / industry): about ${money(g1)} more a month.`,
      'Higher taxes slow growth of every zone and lower residents’ happiness.',
    ],
    actions: [1, 2, 3].map((z) => ({ type: 'setTax', zone: z, rate: all[z]! }) as Command),
    impact: { ...NO_IMPACT, tax: true },
  });
  const biz: [number, number, number, number] = [0, s.tax[1], up(s.tax[2], 3), up(s.tax[3], 3)];
  const g2 = gain(biz);
  out.push({
    title: 'Raise business taxes by 3 points',
    gist: `About ${money(g2)} more a month from shops and industry; slows job growth, homes untouched.`,
    cost: 0,
    monthly: -g2,
    facts: [
      `Shops and industry go to ${biz[2]}% and ${biz[3]}%; homes unchanged: about ${money(g2)} more a month.`,
      'Slows job growth; residents are not taxed more.',
    ],
    actions: [2, 3].map((z) => ({ type: 'setTax', zone: z, rate: biz[z]! }) as Command),
    impact: { ...NO_IMPACT, tax: true },
  });
  const tier = LOAN_TIERS.findIndex((_, i) => !s.loans.some((l) => l.tier === i));
  if (tier >= 0) {
    const t = LOAN_TIERS[tier]!;
    out.push({
      title: `Take a ${money(t.amount)} loan`,
      gist: `${money(t.amount)} now, repaid at ${money(loanPayment(t))} a month for ${t.months} months: buys time, deepens the monthly deficit.`,
      cost: -t.amount,
      monthly: loanPayment(t),
      facts: [`Adds ${money(t.amount)} now; repaid at ${money(loanPayment(t))} a month for ${t.months} months (${Math.round(t.rate * 100)}% interest).`, 'Buys time, but makes the monthly deficit worse until it is repaid.'],
      actions: [{ type: 'takeLoan', tier }],
      impact: { ...NO_IMPACT },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Zoning

interface ZoneSite {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cells: number;
  homesM: number;
}

/** A strip of empty, zoneable land along a straight road. */
function zoneSites(sim: Sim): ZoneSite[] {
  const s = sim.state;
  const out: ZoneSite[] = [];
  for (const e of s.roads.edges) {
    if (!e || e.curved) continue;
    const a = s.roads.nodes[e.a]!;
    const b = s.roads.nodes[e.b]!;
    const horizontal = Math.abs(b.z - a.z) < 1;
    const vertical = Math.abs(b.x - a.x) < 1;
    if (!horizontal && !vertical) continue;
    // Road cells of this edge.
    let i0 = MAP;
    let i1 = -1;
    let j0 = MAP;
    let j1 = -1;
    const pi0 = Math.max(0, Math.floor(Math.min(a.x, b.x) / CELL) - 2);
    const pi1 = Math.min(MAP - 1, Math.floor(Math.max(a.x, b.x) / CELL) + 2);
    const pj0 = Math.max(0, Math.floor(Math.min(a.z, b.z) / CELL) - 2);
    const pj1 = Math.min(MAP - 1, Math.floor(Math.max(a.z, b.z) / CELL) + 2);
    for (let j = pj0; j <= pj1; j++) {
      for (let i = pi0; i <= pi1; i++) {
        if (s.roadCell[j * MAP + i] !== e.id) continue;
        i0 = Math.min(i0, i);
        i1 = Math.max(i1, i);
        j0 = Math.min(j0, j);
        j1 = Math.max(j1, j);
      }
    }
    if (i1 < 0) continue;
    const rects: Array<[number, number, number, number]> = horizontal
      ? [[i0 + 2, j0 - 4, i1 - 2, j0 - 1], [i0 + 2, j1 + 1, i1 - 2, j1 + 4]]
      : [[i0 - 4, j0 + 2, i0 - 1, j1 - 2], [i1 + 1, j0 + 2, i1 + 4, j1 - 2]];
    for (const [x0, y0, x1, y1] of rects) {
      if (x1 - x0 < 3 || y1 - y0 < 3 || x0 < 2 || y0 < 2 || x1 > MAP - 3 || y1 > MAP - 3) continue;
      let cells = 0;
      for (let j = y0; j <= y1; j++) {
        for (let i = x0; i <= x1; i++) {
          const k = j * MAP + i;
          if (s.zone[k] === 0 && s.buildingCell[k]! < 0 && s.roadCell[k]! < 0 && cellMinHeight(s.heights, i, j) >= 0.5 && reachesRoad(s, i, j)) cells++;
        }
      }
      if (cells < 24) continue;
      out.push({ x0, y0, x1, y1, cells, homesM: nearestHome(sim, ((x0 + x1) / 2) * CELL, ((y0 + y1) / 2) * CELL) });
    }
  }
  return out;
}

function zoneOption(sim: Sim, site: ZoneSite, type: ZoneType, density: 1 | 2, why: string): Draft {
  const cx = ((site.x0 + site.x1 + 1) / 2) * CELL;
  const cz = ((site.y0 + site.y1 + 1) / 2) * CELL;
  const label = type === ZoneType.Residential ? 'homes' : type === ZoneType.Commercial ? 'shops and offices' : 'industry';
  return {
    title: `Zone new land for ${label}`,
    gist: `About ${site.cells} empty plots ${describePlace(sim, cx, cz)} for ${label}. ${why}`,
    cost: 0,
    monthly: 0,
    facts: [
      `About ${site.cells} plots of empty land ${describePlace(sim, cx, cz)}, zoned for ${label} (${density === 1 ? 'low' : 'medium'} density). ${why}`,
      `Nearest existing homes: ${metres(site.homesM)}.`,
      'Free to zone; buildings appear as demand allows. More buildings mean more traffic and more power and water use.',
    ],
    actions: [{ type: 'zoneRect', x0: site.x0, y0: site.y0, x1: site.x1, y1: site.y1, zone: zoneCode(type, density) }],
    impact: { ...NO_IMPACT, zoning: true, pollutes: type === ZoneType.Industrial && site.homesM < 160 },
    x: cx,
    z: cz,
  };
}

function demandOptions(sim: Sim, issue: CityIssue): Draft[] {
  const sites = zoneSites(sim);
  if (sites.length === 0) return [];
  const out: Draft[] = [];
  if (issue.kind === 'jobs') {
    const far = [...sites].sort((a, b) => b.homesM - a.homesM)[0]!;
    out.push(zoneOption(sim, far, ZoneType.Industrial, 1, 'Factories hire the most workers per plot.'));
    const near = [...sites].sort((a, b) => a.homesM - b.homesM).find((s) => s !== far);
    if (near) out.push(zoneOption(sim, near, ZoneType.Commercial, 1, 'Shops close to homes give jobs without the pollution.'));
  } else {
    const calm = [...sites].sort((a, b) => {
      const pa = sim.fields.pollution[Math.round((a.y0 + a.y1) / 2) * MAP + Math.round((a.x0 + a.x1) / 2)]!;
      const pb = sim.fields.pollution[Math.round((b.y0 + b.y1) / 2) * MAP + Math.round((b.x0 + b.x1) / 2)]!;
      return pa - pb;
    });
    out.push(zoneOption(sim, calm[0]!, ZoneType.Residential, 1, 'Quiet land with clean air for family homes.'));
    if (calm[1]) out.push(zoneOption(sim, calm[1], ZoneType.Residential, 2, 'Denser housing: more homes per plot.'));
  }
  return out;
}

// ---------------------------------------------------------------------------------------

/** The concrete, already-checked choices the council can pick from for an issue. */
export function optionsFor(sim: Sim, issue: CityIssue): CouncilOption[] {
  let drafts: Draft[] = [];
  switch (issue.kind) {
    case 'traffic': {
      const e = issue.edge ?? -1;
      drafts = [widenRoad(sim, e), reliefRoad(sim, e), flexHours(sim)].filter((d): d is Draft => d !== null);
      break;
    }
    case 'power':
      drafts = powerOptions(sim, issue);
      break;
    case 'water':
      drafts = waterOptions(sim, issue);
      break;
    case 'pollution':
      drafts = pollutionOptions(sim, issue);
      break;
    case 'crime':
      drafts = serviceOptions(sim, FacilityKind.Police, issue, 'Police cover cuts crime around it.');
      break;
    case 'health':
      drafts = serviceOptions(sim, FacilityKind.Clinic, issue, 'Brings a clinic within reach of the uncovered residents.');
      break;
    case 'education':
      drafts = serviceOptions(sim, FacilityKind.School, issue, 'Brings a school within reach of the uncovered families.');
      break;
    case 'fire':
      drafts = serviceOptions(sim, FacilityKind.FireStation, issue, 'Brings fire cover to the uncovered homes.');
      break;
    case 'budget':
      drafts = budgetOptions(sim);
      break;
    case 'jobs':
    case 'housing':
      drafts = demandOptions(sim, issue);
      break;
  }
  drafts.push({
    title: 'Take no action for now',
    gist: 'Nothing is built or changed; the problem is likely to continue.',
    cost: 0,
    monthly: 0,
    facts: ['Nothing is built or changed. The problem is likely to continue.'],
    actions: [],
    impact: { ...NO_IMPACT },
  });
  // Measure every option on a fork of the city. An option the game would refuse never
  // reaches the table, so the council can only ever debate things that can be carried out.
  const limits = fiscalLimits(sim);
  const baseline = baselineOf(sim, true);
  const out: CouncilOption[] = [];
  for (const d of drafts.slice(0, 5)) {
    const p = project(sim, d.actions, { unlimitedFunds: true, withApproval: true, baseline });
    if (!p.ok) continue;
    // The fork is the source of truth for money. Where it disagrees with the estimate the
    // option was drafted with (demolished shops and homes stop paying tax), say so.
    const cost = -p.delta.budgetDelta;
    const monthly = -p.delta.monthlyNetDelta;
    const facts = Math.abs(monthly - d.monthly) > 1 ? [...d.facts, `Counting the tax lost from what it demolishes, the monthly balance changes by ${money(-monthly)} in all.`] : d.facts;
    out.push({ ...d, cost, monthly, facts, id: String.fromCharCode(65 + out.length), effects: p.delta, feasibility: feasibility(limits, p) });
  }
  return out;
}
