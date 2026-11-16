import { CELL, MAP } from '../../core/constants';
import { FacilityKind, Service } from '../../sim/facilities';
import { ROAD_SPECS } from '../../sim/roads/types';
import type { Sim } from '../../sim/sim';
import { POWERED, WATERED } from '../../sim/utilities/network';
import { ZoneType, zoneType } from '../../sim/zoning/zones';
import { stalledByDemand } from '../advice';
import {
  buildingCentre,
  describePlace,
  edgeMid,
  facilityNearEdge,
  metres,
  money,
  residentsNear,
  roadTypeName,
  streetName,
} from './context';
import type { MinistryId } from './ministries';

export type IssueKind = 'traffic' | 'power' | 'water' | 'pollution' | 'crime' | 'health' | 'education' | 'fire' | 'budget' | 'jobs' | 'housing';

/** A problem in the city that a minister can bring to the council. */
export interface CityIssue {
  /** Stable while the same problem persists, so it is not raised twice. */
  key: string;
  kind: IssueKind;
  /** The minister whose portfolio it is. */
  lead: MinistryId;
  /** 0..1. Above about 0.5 the lead minister asks for a meeting. */
  severity: number;
  title: string;
  /** One sentence for the request card and the council header. */
  summary: string;
  /** The measured facts of the problem. */
  facts: string[];
  /**
   * Which ministries a fact concerns, by position in `facts`; absent or undefined means
   * everyone. The lead and the chair always see every fact; the others see only theirs.
   */
  factsFor?: Array<MinistryId[] | undefined>;
  /** World position to show on the map. */
  x: number;
  z: number;
  /** For traffic: the jammed road segment. */
  edge?: number;
  /** For power and water: the road network that is short. */
  comp?: number;
}

/** Cars per 100 m of road (both directions) at which a road counts as jammed. */
export const JAM_DENSITY: Record<number, number> = { 0: 7, 1: 11 };

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function trafficIssue(sim: Sim): CityIssue | null {
  const net = sim.state.roads;
  const dens = sim.traffic.density;
  let worst = -1;
  let worstLoad = 0;
  for (const e of net.edges) {
    if (!e || e.length < 40) continue;
    const load = (dens[e.id] ?? 0) / JAM_DENSITY[e.type]!;
    if (load > worstLoad) {
      worstLoad = load;
      worst = e.id;
    }
  }
  // Only a real jam: ordinary midday traffic stays below this.
  if (worst < 0 || worstLoad < 0.95) return null;
  const e = net.edges[worst]!;
  const mid = edgeMid(sim, e);
  const name = streetName(sim, worst);
  const spec = ROAD_SPECS[e.type];
  const d = dens[worst] ?? 0;
  const hour = sim.traffic.hour;
  const rush = (hour >= 7 && hour < 11) || (hour >= 16 && hour < 20);
  const clinic = facilityNearEdge(sim, FacilityKind.Clinic, e);
  const school = facilityNearEdge(sim, FacilityKind.School, e);
  const fire = facilityNearEdge(sim, FacilityKind.FireStation, e);
  const police = facilityNearEdge(sim, FacilityKind.Police, e);
  return {
    key: `traffic:${name}`,
    kind: 'traffic',
    lead: 'roads',
    severity: clamp01((worstLoad - 0.95) / 0.8 + 0.35),
    title: `Gridlock on ${name}`,
    summary: `${name} is jammed${rush ? ' in the rush hour' : ''}: about ${d.toFixed(1)} cars per 100 m on a ${spec.lanes * 2}-lane ${roadTypeName(e)}.`,
    facts: [
      `${name} (${roadTypeName(e)}, ${spec.lanes} lane${spec.lanes > 1 ? 's' : ''} each way, ${Math.round(e.length)} m segment) ${describePlace(sim, mid.x, mid.z)}.`,
      `Traffic on it: ${d.toFixed(1)} cars per 100 m; it jams at about ${JAM_DENSITY[e.type]}. Time of day ${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}${rush ? ' (rush hour)' : ''}.`,
      `Across the city, queues cost drivers ${Math.round(sim.state.stats.congestion * 100)}% of their normal speed.`,
      `Residents living within 200 m of this road: ${residentsNear(sim, mid.x, mid.z, 200)}.`,
      `Nearest clinic to this road: ${metres(clinic)}. Nearest school: ${metres(school)}.`,
      `Nearest fire station: ${metres(fire)}. Nearest police station: ${metres(police)}.`,
    ],
    // Distances to clinics and schools matter to the ministries that run them; the rest
    // of the council argues about the jam itself.
    factsFor: [undefined, undefined, undefined, ['welfare', 'planning', 'health', 'safety'], ['health', 'education'], ['safety']],
    x: mid.x,
    z: mid.z,
    edge: worst,
  };
}

function utilityIssue(sim: Sim, what: 'power' | 'water'): CityIssue | null {
  const s = sim.state;
  const st = s.stats;
  if (s.sandbox) return null;
  const supply = what === 'power' ? st.powerSupply : st.waterSupply;
  const demand = what === 'power' ? st.powerDemand : st.waterDemand;
  const unserved = what === 'power' ? st.unpowered : st.unwatered;
  if (supply <= 0 || (demand < supply * 0.9 && unserved === 0)) return null;
  // Find the network that is worst off and a point on it.
  const net = sim.net;
  let comp = -1;
  let worst = 0;
  for (let c = 0; c < net.count; c++) {
    const sp = what === 'power' ? net.powerSupply[c]! : net.waterSupply[c]!;
    const dm = what === 'power' ? net.powerDemand[c]! : net.waterDemand[c]!;
    if (dm <= 0) continue;
    const ratio = sp > 0 ? dm / sp : 3;
    if (ratio > worst) {
      worst = ratio;
      comp = c;
    }
  }
  if (comp < 0) return null;
  let cx = 0;
  let cz = 0;
  let n = 0;
  const bit = what === 'power' ? POWERED : WATERED;
  let affected = 0;
  for (const b of s.buildings) {
    if (!b || b.kind !== 0 || b.progress < 1) continue;
    const c = buildingCentre(b);
    if (!(b.flags & bit)) {
      affected += zoneType(b.zone) === ZoneType.Residential ? b.pop : 0;
      cx += c.x;
      cz += c.z;
      n++;
    }
  }
  if (n === 0) {
    // Near capacity but nobody cut off yet: point at the network's road.
    for (let k = 0; k < MAP * MAP; k += 7) {
      if (net.comp[k] === comp) {
        cx = ((k % MAP) + 0.5) * CELL;
        cz = (Math.floor(k / MAP) + 0.5) * CELL;
        n = 1;
        break;
      }
    }
  } else {
    cx /= n;
    cz /= n;
  }
  const unit = what === 'power' ? 'MW' : 'water units';
  const fmt = (v: number): string => (what === 'power' ? v.toFixed(1) : Math.round(v).toLocaleString('en-US'));
  const short = demand > supply;
  return {
    key: `${what}:${comp}`,
    kind: what,
    lead: 'energy',
    severity: clamp01((demand / supply - 0.85) * 2.5 + (unserved > 0 ? 0.3 : 0)),
    title: short ? `${what === 'power' ? 'Power' : 'Water'} shortage` : `${what === 'power' ? 'Power' : 'Water'} nearly at capacity`,
    summary: `${what === 'power' ? 'Power' : 'Water'} demand is ${fmt(demand)} ${unit} against ${fmt(supply)} supplied${unserved ? `; ${unserved} buildings are cut off` : ''}.`,
    facts: [
      `City ${what}: demand ${fmt(demand)} ${unit}, supply ${fmt(supply)} ${unit} (${Math.round((demand / supply) * 100)}% used).`,
      `Buildings currently without ${what}: ${unserved}${affected ? `, including homes for ${affected} residents` : ''}.`,
      `Without ${what}, residents move out and nothing new is built on that street.`,
      `The worst-off area is ${describePlace(sim, cx, cz)}.`,
    ],
    x: cx,
    z: cz,
    comp,
  };
}

/** Residential buildings above a threshold in a field, with their centroid and residents. */
function homesWhere(sim: Sim, test: (k: number) => boolean): { n: number; residents: number; x: number; z: number } {
  let n = 0;
  let residents = 0;
  let x = 0;
  let z = 0;
  let w = 0;
  for (const b of sim.state.buildings) {
    if (!b || b.kind !== 0 || b.progress < 1 || zoneType(b.zone) !== ZoneType.Residential) continue;
    const k = (b.y + (b.h >> 1)) * MAP + b.x + (b.w >> 1);
    if (!test(k)) continue;
    const c = buildingCentre(b);
    const weight = Math.max(1, b.pop);
    n++;
    residents += b.pop;
    x += c.x * weight;
    z += c.z * weight;
    w += weight;
  }
  return { n, residents, x: w ? x / w : 0, z: w ? z / w : 0 };
}

function pollutionIssue(sim: Sim): CityIssue | null {
  const f = sim.fields;
  const hit = homesWhere(sim, (k) => f.pollution[k]! > 0.3);
  if (hit.residents < 40) return null;
  const pop = Math.max(1, sim.state.stats.population);
  let coal = 0;
  let industry = 0;
  for (const b of sim.state.buildings) {
    if (!b || b.progress < 1) continue;
    const c = buildingCentre(b);
    if (Math.hypot(c.x - hit.x, c.z - hit.z) > 450) continue;
    if (b.kind === FacilityKind.CoalPlant) coal++;
    else if (b.kind === 0 && zoneType(b.zone) === ZoneType.Industrial) industry++;
  }
  const sources = [coal ? `${coal} coal power plant${coal > 1 ? 's' : ''}` : '', industry ? `${industry} industrial buildings` : ''].filter(Boolean).join(' and ') || 'traffic and industry';
  return {
    key: `pollution:${Math.round(hit.x / 200)}:${Math.round(hit.z / 200)}`,
    kind: 'pollution',
    lead: 'environment',
    severity: clamp01((hit.residents / pop) * 2.2 + 0.2),
    title: 'Polluted neighbourhood',
    summary: `${hit.residents} residents ${describePlace(sim, hit.x, hit.z)} are breathing heavily polluted air.`,
    facts: [
      `${hit.n} home${hit.n > 1 ? 's' : ''} (${hit.residents} residents, ${Math.round((hit.residents / pop) * 100)}% of the city) ${hit.n > 1 ? 'have' : 'has'} pollution above 30%.`,
      `Sources within 450 m: ${sources}.`,
      `Pollution cuts land value and happiness, and stops homes from upgrading.`,
    ],
    x: hit.x,
    z: hit.z,
  };
}

function crimeIssue(sim: Sim): CityIssue | null {
  const f = sim.fields;
  const police = f.coverage[Service.Police]!;
  const hit = homesWhere(sim, (k) => f.crime[k]! * 2.2 > 0.3 && police[k]! < 0.25);
  if (hit.residents < 60) return null;
  return {
    key: `crime:${Math.round(hit.x / 250)}:${Math.round(hit.z / 250)}`,
    kind: 'crime',
    lead: 'safety',
    severity: clamp01(hit.residents / Math.max(1, sim.state.stats.population) * 2 + 0.25),
    title: 'Rising crime',
    summary: `Crime is high ${describePlace(sim, hit.x, hit.z)}, where ${hit.residents} residents have little or no police cover.`,
    facts: [
      `${hit.n} homes (${hit.residents} residents) have high crime and weak police cover.`,
      `Police stations in the city: ${sim.state.buildings.filter((b) => b && b.kind === FacilityKind.Police).length}.`,
      `Crime lowers land value and happiness.`,
    ],
    x: hit.x,
    z: hit.z,
  };
}

function coverageIssue(sim: Sim, service: Service, kind: IssueKind, lead: MinistryId, label: string, facility: string): CityIssue | null {
  const pop = sim.state.stats.population;
  if (pop < 250) return null;
  const cov = sim.fields.coverage[service]!;
  const hit = homesWhere(sim, (k) => cov[k]! < 0.05);
  const share = hit.residents / Math.max(1, pop);
  if (share < 0.35) return null;
  return {
    key: `${kind}:${Math.round(hit.x / 300)}:${Math.round(hit.z / 300)}`,
    kind,
    lead,
    severity: clamp01((share - 0.25) * 1.6 + 0.2),
    title: `No ${label} nearby`,
    summary: `${hit.residents} residents (${Math.round(share * 100)}%) live beyond the reach of any ${facility}.`,
    facts: [
      `${hit.residents} of ${pop} residents (${Math.round(share * 100)}%) have no ${facility} within reach; most of them live ${describePlace(sim, hit.x, hit.z)}.`,
      `Living within reach of a ${facility} raises happiness and land value.`,
    ],
    x: hit.x,
    z: hit.z,
  };
}

function budgetIssue(sim: Sim): CityIssue | null {
  const s = sim.state;
  if (s.sandbox) return null;
  const r = s.report;
  if (r.net >= 0 || s.funds > 30000) return null;
  const hours = r.net < 0 ? Math.floor(s.funds / -r.net) : 99;
  return {
    key: 'budget',
    kind: 'budget',
    lead: 'finance',
    severity: clamp01(1 - hours / 18),
    title: 'Budget deficit',
    summary: `The city loses ${money(-r.net)} an hour and has ${money(s.funds)} left: about ${hours} hours.`,
    facts: [
      `Treasury: ${money(s.funds)}. Last hour: income ${money(r.income)}, spending ${money(r.expense)}, balance ${money(r.net)}.`,
      `Income: residential tax ${money(r.taxR)}, commercial ${money(r.taxC)}, industrial ${money(r.taxI)}. Tax rates ${s.tax[1]}% / ${s.tax[2]}% / ${s.tax[3]}%.`,
      `Spending: roads ${money(r.roads)}, utilities ${money(r.utilities)}, services ${money(r.services)}, loan repayments ${money(r.loans)}.`,
    ],
    x: 0,
    z: 0,
  };
}

function demandIssue(sim: Sim, kind: 'jobs' | 'housing'): CityIssue | null {
  const s = sim.state;
  if (s.sandbox || s.stats.population < 80) return null;
  const st = s.stats;
  const labor = st.population * 0.55;
  const unemployment = labor > 0 ? Math.max(0, 1 - st.employed / labor) : 0;
  if (kind === 'jobs') {
    if (!stalledByDemand(sim, ZoneType.Residential) && unemployment < 0.15) return null;
    return {
      key: 'jobs',
      kind: 'jobs',
      lead: 'planning',
      severity: clamp01(unemployment * 1.8 + (stalledByDemand(sim, ZoneType.Residential) ? 0.35 : 0)),
      title: 'Not enough jobs',
      summary: `${Math.round(unemployment * 100)}% of the workforce has no job, and new homes have stopped being built.`,
      facts: [
        `Workers: ${Math.round(labor)}; employed: ${st.employed}; unemployment ${Math.round(unemployment * 100)}%.`,
        `Jobs: ${st.jobsC} in shops and offices, ${st.jobsI} in industry. Demand: homes ${Math.round(st.demand[1] * 100)}, shops ${Math.round(st.demand[2] * 100)}, industry ${Math.round(st.demand[3] * 100)} (out of ±100).`,
        `Homes only grow while there are jobs for the people who would live in them.`,
      ],
      x: 0,
      z: 0,
    };
  }
  if (!(st.demand[1] > 0.3 && (stalledByDemand(sim, ZoneType.Commercial) || stalledByDemand(sim, ZoneType.Industrial)))) return null;
  return {
    key: 'housing',
    kind: 'housing',
    lead: 'planning',
    severity: clamp01(st.demand[1] * 0.9),
    title: 'Housing shortage',
    summary: `People want to move in (housing demand ${Math.round(st.demand[1] * 100)}), but there is no zoned land for new homes.`,
    facts: [
      `Housing demand ${Math.round(st.demand[1] * 100)} out of 100. Shops and industry have stopped growing for lack of workers and customers.`,
      `Population ${st.population}; homes for ${st.housing}.`,
    ],
    x: 0,
    z: 0,
  };
}

/** Every current problem in the city, most severe first. */
export function detectIssues(sim: Sim): CityIssue[] {
  const out: Array<CityIssue | null> = [
    trafficIssue(sim),
    utilityIssue(sim, 'power'),
    utilityIssue(sim, 'water'),
    pollutionIssue(sim),
    crimeIssue(sim),
    coverageIssue(sim, Service.Health, 'health', 'health', 'clinic', 'clinic'),
    coverageIssue(sim, Service.Education, 'education', 'education', 'school', 'school'),
    coverageIssue(sim, Service.Fire, 'fire', 'safety', 'fire cover', 'fire station'),
    budgetIssue(sim),
    demandIssue(sim, 'jobs'),
    demandIssue(sim, 'housing'),
  ];
  return out.filter((i): i is CityIssue => i !== null).sort((a, b) => b.severity - a.severity);
}
