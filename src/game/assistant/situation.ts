import { MAP, MONTH_NAMES } from '../../core/constants';
import { emptyReport, projectBudget } from '../../sim/economy/budget';
import { FACILITIES, FacilityKind } from '../../sim/facilities';
import type { Sim } from '../../sim/sim';
import { dateOf } from '../../sim/state';
import { frontageOf } from '../../sim/zoning/lots';
import { ZoneType } from '../../sim/zoning/zones';
import { activeStations } from '../../sim/transit/metro';
import { STALL_REASON, stalledZones } from '../advice';

/** Something the player tried that the game refused, with the game's own reason. */
export interface Refusal {
  what: string;
  reason: string;
  when: string;
}

/** A problem the council knows about, in the form the assistant may offer to convene on. */
export interface KnownIssue {
  key: string;
  title: string;
  severity: number;
}

const ZONE_NAME: Record<number, string> = { [ZoneType.Residential]: 'Homes', [ZoneType.Commercial]: 'Shops', [ZoneType.Industrial]: 'Industry' };

/** Short messages about what is holding the city back, most important first (the HUD's alerts). */
export function cityAlerts(sim: Sim): string[] {
  const s = sim.state;
  const st = s.stats;
  const out: string[] = [];
  if (s.sandbox) return out;
  if (!s.roads.edges.some((e) => e)) return ['Start by laying a street'];
  if (st.powerSupply === 0) out.push('No power: build a power plant beside a road');
  else if (st.powerDemand > st.powerSupply) out.push('Power shortage');
  else if (st.powerDemand > st.powerSupply * 0.9) out.push('Power nearly at capacity');
  if (st.waterSupply === 0) out.push('No water: build a water tower beside a road');
  else if (st.waterDemand > st.waterSupply) out.push('Water shortage');
  else if (st.waterDemand > st.waterSupply * 0.9) out.push('Water nearly at capacity');
  const utilitiesOk = st.powerSupply > 0 && st.waterSupply > 0 && st.powerDemand <= st.powerSupply && st.waterDemand <= st.waterSupply;
  if (utilitiesOk) for (const t of stalledZones(sim)) out.push(STALL_REASON[t]!);
  const net = projectBudget(s.buildings, s.roads, s.tax, s.loans, st, emptyReport(), s.policies, s.metro).net;
  if (net < 0 && s.funds < 15000 && st.population > 0) out.push('The city is losing money');
  return out;
}

/** Zoned, empty land per zone type: waiting by a road, waiting without utilities, or too far from any road. */
export function zonedLand(sim: Sim): Record<number, { ready: number; unserved: number; noRoad: number }> {
  const s = sim.state;
  const out: Record<number, { ready: number; unserved: number; noRoad: number }> = {
    [ZoneType.Residential]: { ready: 0, unserved: 0, noRoad: 0 },
    [ZoneType.Commercial]: { ready: 0, unserved: 0, noRoad: 0 },
    [ZoneType.Industrial]: { ready: 0, unserved: 0, noRoad: 0 },
  };
  for (let j = 1; j < MAP - 1; j++) {
    for (let i = 1; i < MAP - 1; i++) {
      const k = j * MAP + i;
      const z = s.zone[k]!;
      if (z === 0 || s.buildingCell[k]! >= 0 || s.roadCell[k]! >= 0) continue;
      const row = out[z >> 2];
      if (!row) continue;
      if (frontageOf(s, i, j) < 0) row.noRoad++;
      else if (s.sandbox || sim.served(i, j)) row.ready++;
      else row.unserved++;
    }
  }
  return out;
}

/**
 * The city as it stands, in plain lines: what the assistant answers from. Every figure is
 * read from the simulation at the moment the question is asked.
 */
export function citySituation(sim: Sim, extra: { refusals: readonly Refusal[]; issues: readonly KnownIssue[]; tool: string; hour: number }): string {
  const s = sim.state;
  const st = s.stats;
  const d = dateOf(s.tick);
  const usd = (n: number): string => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
  const budget = projectBudget(s.buildings, s.roads, s.tax, s.loans, st, emptyReport(), s.policies, s.metro);
  const lines: string[] = [];
  lines.push(`City: ${s.cityName}. Date ${d.day} ${MONTH_NAMES[d.month]} ${d.year}, ${String(Math.floor(extra.hour)).padStart(2, '0')}:00. Speed ${s.speed === 0 ? 'paused' : s.speed}.${s.sandbox ? ' Sandbox mode (unlimited money, no utilities needed).' : ''}`);
  lines.push(`Money: ${s.sandbox ? 'unlimited' : usd(s.funds)}; projected monthly ${budget.net >= 0 ? 'surplus' : 'deficit'} ${usd(budget.net)} (income ${usd(budget.income)}, spending ${usd(budget.expense)}: roads ${usd(budget.roads)}, utilities ${usd(budget.utilities)}, services ${usd(budget.services)}, loans ${usd(budget.loans)}). Taxes: homes ${s.tax[1]}%, shops ${s.tax[2]}%, industry ${s.tax[3]}%. Loans: ${s.loans.length}.`);
  lines.push(`People: ${st.population} residents, ${st.employed} employed, homes for ${st.housing}; jobs: shops ${st.jobsC}, industry ${st.jobsI}. Happiness ${Math.round(st.happiness * 100)}%.`);
  const dem = (v: number): string => `${v > 0.02 ? '+' : ''}${Math.round(v * 100)}%`;
  lines.push(`Demand: homes ${dem(st.demand[1]!)}, shops ${dem(st.demand[2]!)}, industry ${dem(st.demand[3]!)} (at or below 0 that zone stops growing).`);
  lines.push(`Power: ${st.powerSupply} MW supplied, ${st.powerDemand.toFixed(1)} MW used; ${st.unpowered} finished buildings without power. Water: ${st.waterSupply} supplied, ${Math.round(st.waterDemand)} used; ${st.unwatered} finished buildings without water.`);
  const roads = s.roads.edges.filter((e) => e).length;
  lines.push(`Roads: ${roads} road segments. Traffic congestion ${Math.round(st.congestion * 100)}%, ${st.vehicles} cars on the road.`);
  const stations = s.buildings.filter((b) => b && b.kind === FacilityKind.MetroStation).length;
  const metroLines = (s.metro?.lines ?? []).filter((l) => l);
  const km = metroLines.reduce((t, l) => t + l!.length, 0) / 1000;
  lines.push(`Metro: ${stations} station${stations === 1 ? '' : 's'}, ${metroLines.length} line${metroLines.length === 1 ? '' : 's'} (${km.toFixed(1)} km), ${activeStations(s).size} stations connected, ${st.metroRiders ?? 0} daily riders; fares ${usd(budget.fares)}/month, upkeep ${usd(budget.transit)}/month.`);
  const counts = new Map<number, number>();
  let growing = 0;
  let building = 0;
  for (const b of s.buildings) {
    if (!b) continue;
    if (b.kind === 0) {
      if (b.progress < 1) building++;
      else growing++;
    } else counts.set(b.kind, (counts.get(b.kind) ?? 0) + 1);
  }
  const fac = [...counts].map(([k, n]) => `${n} ${FACILITIES[k]!.name}${n > 1 ? 's' : ''}`).join(', ');
  lines.push(`Buildings: ${growing} finished zoned buildings, ${building} under construction. Facilities: ${fac || 'none'}.${counts.has(FacilityKind.TownHall) ? '' : ' (No town hall.)'}`);
  const land = zonedLand(sim);
  const landLine = [ZoneType.Residential, ZoneType.Commercial, ZoneType.Industrial]
    .map((t) => {
      const r = land[t]!;
      if (r.ready + r.unserved + r.noRoad === 0) return `${ZONE_NAME[t]}: no empty zoned land`;
      return `${ZONE_NAME[t]}: ${r.ready} cells ready by a served road, ${r.unserved} cells by a road without spare power or water, ${r.noRoad} cells too far from any road`;
    })
    .join('; ');
  lines.push(`Empty zoned land (cells of 8 m): ${landLine}.`);
  const alerts = cityAlerts(sim);
  lines.push(`Warnings on screen: ${alerts.length ? alerts.join('; ') : 'none'}.`);
  lines.push(
    `Problems the council knows about: ${extra.issues.length ? extra.issues.map((i) => `[${i.key}] ${i.title} (severity ${Math.round(i.severity * 100)}%)`).join('; ') : 'none'}.`,
  );
  lines.push(`Recent things the game refused: ${extra.refusals.length ? extra.refusals.map((r) => `${r.what} (${r.when}): "${r.reason}"`).join('; ') : 'none'}.`);
  lines.push(`Tool in hand: ${extra.tool}.`);
  return lines.join('\n');
}
