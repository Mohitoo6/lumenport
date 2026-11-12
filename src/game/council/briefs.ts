import { MAP } from '../../core/constants';
import { FacilityKind, Service } from '../../sim/facilities';
import { ROAD_SPECS } from '../../sim/roads/types';
import type { Sim } from '../../sim/sim';
import { ZoneType, zoneType } from '../../sim/zoning/zones';
import { money, streetName } from './context';
import type { CityIssue } from './issues';
import type { MinistryId } from './ministries';
import type { CouncilOption } from './options';

/**
 * Each minister's own dashboard: the numbers their department would bring to the meeting.
 * Ministers see the shared issue and options plus this, never the whole city state, so
 * each argues from their own portfolio.
 */

function count(sim: Sim, kind: FacilityKind): number {
  return sim.state.buildings.filter((b) => b && b.kind === kind && b.progress >= 1).length;
}

/** Share of residents with less than `min` cover from a service. */
function uncovered(sim: Sim, service: Service, min = 0.05): number {
  const cov = sim.fields.coverage[service]!;
  let out = 0;
  let all = 0;
  for (const b of sim.state.buildings) {
    if (!b || b.kind !== 0 || b.progress < 1 || zoneType(b.zone) !== ZoneType.Residential) continue;
    const k = (b.y + (b.h >> 1)) * MAP + b.x + (b.w >> 1);
    all += b.pop;
    if (cov[k]! < min) out += b.pop;
  }
  return all > 0 ? out / all : 0;
}

function homesAbove(sim: Sim, field: Float32Array, level: number): number {
  let n = 0;
  for (const b of sim.state.buildings) {
    if (!b || b.kind !== 0 || b.progress < 1 || zoneType(b.zone) !== ZoneType.Residential) continue;
    if (field[(b.y + (b.h >> 1)) * MAP + b.x + (b.w >> 1)]! > level) n += b.pop;
  }
  return n;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;

export function briefing(sim: Sim, id: MinistryId): string[] {
  const s = sim.state;
  const st = s.stats;
  const r = s.report;
  const pop = st.population;
  const labor = pop * 0.55;
  const unemployment = labor > 0 ? Math.max(0, 1 - st.employed / labor) : 0;
  switch (id) {
    case 'roads': {
      const dens = sim.traffic.density;
      const busiest = s.roads.edges
        .filter((e) => e && e.length > 40)
        .map((e) => ({ e: e!, d: dens[e!.id] ?? 0 }))
        .sort((a, b) => b.d - a.d)
        .slice(0, 3)
        .map(({ e, d }) => `${streetName(sim, e.id)} ${d.toFixed(1)} cars/100 m (${ROAD_SPECS[e.type].name.toLowerCase()})`);
      let length = 0;
      for (const e of s.roads.edges) if (e) length += e.length;
      return [
        `Vehicles on the road now: ${sim.traffic.count}. Speed lost to queues city-wide: ${pct(st.congestion)}.`,
        `Busiest roads: ${busiest.join('; ') || 'none'}.`,
        `Road network: ${(length / 1000).toFixed(1)} km; upkeep ${money(r.roads)} a month.`,
        `Policy: staggered office hours ${s.policies?.flexHours ? 'in force' : 'not in force'}.`,
      ];
    }
    case 'energy':
      return [
        `Power: ${st.powerDemand.toFixed(1)} MW used of ${st.powerSupply} MW (${st.powerSupply ? pct(st.powerDemand / st.powerSupply) : 'no supply'}). Buildings without power: ${st.unpowered}.`,
        `Water: ${Math.round(st.waterDemand)} of ${st.waterSupply} units (${st.waterSupply ? pct(st.waterDemand / st.waterSupply) : 'no supply'}). Buildings without water: ${st.unwatered}.`,
        `Plants: ${count(sim, FacilityKind.CoalPlant)} coal, ${count(sim, FacilityKind.WindTurbine)} wind, ${count(sim, FacilityKind.SolarFarm)} solar; ${count(sim, FacilityKind.WaterTower)} water towers, ${count(sim, FacilityKind.WaterPump)} pumping stations.`,
      ];
    case 'health':
      return [
        `Clinics: ${count(sim, FacilityKind.Clinic)}. Residents without a clinic within reach: ${pct(uncovered(sim, Service.Health))}.`,
        `Residents breathing polluted air (above 30%): ${homesAbove(sim, sim.fields.pollution, 0.3)} of ${pop}.`,
        `City happiness: ${pct(st.happiness)}.`,
      ];
    case 'safety':
      return [
        `Police stations: ${count(sim, FacilityKind.Police)}; residents without police cover: ${pct(uncovered(sim, Service.Police))}.`,
        `Fire stations: ${count(sim, FacilityKind.FireStation)}; residents without fire cover: ${pct(uncovered(sim, Service.Fire))}.`,
        `Residents in high-crime areas: ${homesAbove(sim, sim.fields.crime, 0.14)}. Speed lost to traffic (slows emergency response): ${pct(st.congestion)}.`,
      ];
    case 'education':
      return [
        `Schools: ${count(sim, FacilityKind.School)}. Residents without a school within reach: ${pct(uncovered(sim, Service.Education))}.`,
        `Population ${pop}; better education lets homes upgrade and attracts better jobs.`,
      ];
    case 'environment':
      return [
        `Residents breathing polluted air (above 30%): ${homesAbove(sim, sim.fields.pollution, 0.3)} of ${pop}.`,
        `Coal plants: ${count(sim, FacilityKind.CoalPlant)}; clean plants: ${count(sim, FacilityKind.WindTurbine) + count(sim, FacilityKind.SolarFarm)}. Parks: ${count(sim, FacilityKind.Park)}.`,
        `Vehicles on the road: ${sim.traffic.count}.`,
      ];
    case 'finance':
      return [
        s.sandbox ? 'Sandbox city: money is unlimited.' : `Treasury: ${money(s.funds)}. Projected monthly balance: ${money(r.net)} (income ${money(r.income)}, spending ${money(r.expense)}).`,
        `Tax rates: homes ${s.tax[1]}%, shops ${s.tax[2]}%, industry ${s.tax[3]}%. Loans outstanding: ${s.loans.length}.`,
        `Monthly spending: roads ${money(r.roads)}, utilities ${money(r.utilities)}, services ${money(r.services)}, loans ${money(r.loans)}.`,
      ];
    case 'planning': {
      let empty = 0;
      for (let k = 0; k < s.zone.length; k++) if (s.zone[k] && s.buildingCell[k]! < 0) empty++;
      return [
        `Population ${pop}; homes for ${st.housing}. Jobs: ${st.jobsC} in shops and offices, ${st.jobsI} in industry.`,
        `Demand (−100 to 100): homes ${Math.round(st.demand[1] * 100)}, shops ${Math.round(st.demand[2] * 100)}, industry ${Math.round(st.demand[3] * 100)}.`,
        `Zoned plots still empty: ${empty}.`,
      ];
    }
    case 'welfare':
      return [
        `City happiness: ${pct(st.happiness)}. Unemployment: ${pct(unemployment)} of ${Math.round(labor)} workers.`,
        `Residents without clinic / school / police cover: ${pct(uncovered(sim, Service.Health))} / ${pct(uncovered(sim, Service.Education))} / ${pct(uncovered(sim, Service.Police))}.`,
        `Residential tax: ${s.tax[1]}%.`,
      ];
  }
}

export interface Seat {
  id: MinistryId;
  /** Why this minister was called in: shown to them, so they speak to it. */
  reason: string;
}

/**
 * Who comes to the meeting. The lead always does; others only when an option or the issue
 * touches their portfolio. A minister called in may still decide they have nothing to say.
 */
export function attendees(sim: Sim, issue: CityIssue, options: readonly CouncilOption[], max = 6): Seat[] {
  const any = (f: (o: CouncilOption) => boolean): CouncilOption[] => options.filter(f);
  const ids = (list: CouncilOption[]): string => list.map((o) => o.id).join(', ');
  const scored: Array<{ id: MinistryId; score: number; reason: string }> = [];
  const add = (id: MinistryId, score: number, reason: string): void => {
    if (id === issue.lead || score <= 0) return;
    const existing = scored.find((s) => s.id === id);
    if (existing) {
      if (score > existing.score) Object.assign(existing, { score, reason });
    } else scored.push({ id, score, reason });
  };

  const costly = any((o) => o.cost > 0 || o.monthly > 0);
  if (costly.length) add('finance', 2 + Math.min(3, Math.max(...costly.map((o) => o.cost)) / Math.max(1, sim.state.funds) * 10), `options ${ids(costly)} cost money`);
  if (issue.kind === 'budget') add('welfare', 3, 'tax rises fall on residents');

  const nearClinic = any((o) => o.impact.clinicM < 300);
  if (nearClinic.length) add('health', 4, `options ${ids(nearClinic)} bring traffic or pollution near a clinic`);
  if (issue.kind === 'pollution') add('health', 4, 'residents are breathing polluted air');
  const pollutes = any((o) => o.impact.pollutes);
  if (pollutes.length) {
    add('health', 3.5, `options ${ids(pollutes)} add a polluter near homes`);
    add('environment', 5, `options ${ids(pollutes)} add a polluter near homes`);
  }

  const nearSchool = any((o) => o.impact.schoolM < 250);
  if (nearSchool.length) add('education', 4, `options ${ids(nearSchool)} bring traffic or pollution near a school`);

  const displaced = any((o) => o.impact.displacedResidents > 0 || o.impact.jobsLost > 0);
  if (displaced.length) {
    add('welfare', 4.5, `options ${ids(displaced)} demolish homes or workplaces`);
    add('planning', 4, `options ${ids(displaced)} demolish buildings`);
  }
  const zoning = any((o) => o.impact.zoning);
  if (zoning.length) add('planning', 3, `options ${ids(zoning)} change land use`);
  const trees = any((o) => o.impact.treesCleared > 5);
  if (trees.length) add('environment', 2.5, `options ${ids(trees)} clear trees`);
  const green = any((o) => o.impact.green);
  if (green.length) add('environment', 2, `options ${ids(green)} are green options`);
  const cut = any((o) => o.impact.powerCut);
  if (cut.length) add('energy', 5, `options ${ids(cut)} cut power supply`);
  const tax = any((o) => o.impact.tax);
  if (tax.length) add('planning', 2.5, 'tax changes slow growth');

  if (issue.kind === 'traffic' && issue.edge !== undefined) {
    const e = sim.state.roads.edges[issue.edge];
    const emergency = e ? Math.min(...[FacilityKind.FireStation, FacilityKind.Police, FacilityKind.Clinic].map((k) => nearest(sim, k, issue))) : Infinity;
    if (emergency < 450) add('safety', 3.5, 'emergency vehicles use this road');
    add('environment', 1.5, 'queuing traffic adds fumes');
  }
  if (issue.kind === 'jobs' || issue.kind === 'housing') {
    add('welfare', 3, 'jobs and homes for residents');
    if (any((o) => o.impact.zoning).length) add('roads', 1.8, 'new districts add traffic');
  }
  if (issue.kind === 'health' || issue.kind === 'education' || issue.kind === 'crime' || issue.kind === 'fire') add('welfare', 2.2, 'residents’ wellbeing');
  if (issue.kind === 'power' || issue.kind === 'water') add('planning', 1.5, 'shortages stop growth');

  scored.sort((a, b) => b.score - a.score);
  return [{ id: issue.lead, reason: 'it is your portfolio and you raised it' }, ...scored.slice(0, max - 1).map(({ id, reason }) => ({ id, reason }))];
}

function nearest(sim: Sim, kind: FacilityKind, issue: CityIssue): number {
  let best = Infinity;
  for (const b of sim.state.buildings) {
    if (!b || b.kind !== kind || b.progress < 1) continue;
    best = Math.min(best, Math.hypot((b.x + b.w / 2) * 8 - issue.x, (b.y + b.h / 2) * 8 - issue.z));
  }
  return best;
}
