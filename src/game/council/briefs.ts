import { MAP } from '../../core/constants';
import { emptyReport, projectBudget } from '../../sim/economy/budget';
import { FacilityKind, Service } from '../../sim/facilities';
import { ROAD_SPECS } from '../../sim/roads/types';
import type { Sim } from '../../sim/sim';
import { ZoneType, zoneType } from '../../sim/zoning/zones';
import { money, streetName } from './context';
import type { MinistryId } from './ministries';

/**
 * Each minister's own dashboard: the numbers their department would bring to the meeting.
 * Ministers see the shared issue and options plus this, never the whole city state, so
 * each argues from their own portfolio.
 */

export function count(sim: Sim, kind: FacilityKind): number {
  return sim.state.buildings.filter((b) => b && b.kind === kind && b.progress >= 1).length;
}

/** Share of residents with less than `min` cover from a service. */
export function uncovered(sim: Sim, service: Service, min = 0.05): number {
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

export function homesAbove(sim: Sim, field: Float32Array, level: number): number {
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
        `Road network: ${(length / 1000).toFixed(1)} km; upkeep ${money(r.roads)} an hour.`,
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
    case 'finance': {
      // The city as it stands today, the same projection the shared budget line uses, so
      // Finance never sees two different figures for the hourly balance.
      const b = projectBudget(s.buildings, s.roads, s.tax, s.loans, st, emptyReport(), s.policies, s.metro);
      return [
        s.sandbox ? 'Sandbox city: money is unlimited.' : `Hourly income ${money(b.income)}, spending ${money(b.expense)}: roads ${money(b.roads)}, utilities ${money(b.utilities)}, services ${money(b.services)}, loan repayments ${money(b.loans)}.`,
        `Tax rates: homes ${s.tax[1]}%, shops ${s.tax[2]}%, industry ${s.tax[3]}%. Loans outstanding: ${s.loans.length}.`,
      ];
    }
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
