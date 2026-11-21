import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { TICKS_PER_HOUR } from '../../src/core/constants';
import { detectIssues } from '../../src/game/council/issues';
import { stalledZones } from '../../src/game/advice';
import { zonedLand } from '../../src/game/assistant/situation';
import { FacilityKind } from '../../src/sim/facilities';
import { GOALS } from '../../src/sim/goals';
import { projectBudget, emptyReport } from '../../src/sim/economy/budget';
import { RoadType } from '../../src/sim/roads/types';
import { Sim } from '../../src/sim/sim';

/**
 * A scripted playthrough on the real economy: a bot that plays like a sensible new player
 * (grid of streets, zones in a mix, a plant and water when short, services when the goal
 * asks for them, taxes left alone). Logs the city every game hour (one real minute at
 * normal speed) to see whether the pacing, money and demand hold up.
 *
 *   npx vitest run --config vitest.eval.config.ts playtest
 */
it('plays a city for 40 game hours', () => {
  const sim = Sim.create(2024);
  const s = sim.state;
  const log: string[] = [];
  const place = (kind: number, ci: number, cj: number): boolean => {
    for (let r = 0; r <= 40; r++)
      for (let j = cj - r; j <= cj + r; j++)
        for (let i = ci - r; i <= ci + r; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || !sim.planFacility(kind, i, j).ok) continue;
          if (sim.apply({ type: 'placeFacility', kind, x: i, y: j }).ok) return true;
        }
    return false;
  };
  // A district at a time: a connected street grid (96 m blocks), zoned along its streets
  // like the Homes tool does: three parts homes, one part shops, one part industry.
  let districts = 0;
  const district = (): void => {
    const x0 = 1040 + (districts % 3) * 384;
    const z0 = 424 + Math.floor(districts / 3) * 288;
    const before = s.roads.edges.length;
    for (let k = 0; k <= 3; k++) sim.apply({ type: 'buildRoad', road: k === 0 && districts < 3 ? RoadType.Avenue : RoadType.Street, ax: x0, az: z0 + k * 96, bx: x0 + 384, bz: z0 + k * 96 });
    for (let k = 0; k <= 4; k++) sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: x0 + k * 96, az: z0, bx: x0 + k * 96, bz: z0 + 288 });
    const fresh: number[] = [];
    for (let e = before; e < s.roads.edges.length; e++) if (s.roads.edges[e]) fresh.push(e);
    const dens = districts < 2 ? 1 : 2;
    fresh.forEach((e, n) => {
      const kind = n % 5 < 3 ? 4 : n % 5 === 3 ? 8 : 12;
      sim.apply({ type: 'zoneAlong', edges: [e], zone: kind + (kind === 12 ? 1 : dens) });
    });
    districts++;
  };
  district();
  place(FacilityKind.CoalPlant, 150, 50);
  place(FacilityKind.WaterTower, 135, 70);
  let reached = 0;
  sim.events.on('goalReached', (g) => log.push(`   >> goal ${++reached}: ${g.title}${g.reward ? ` (+$${g.reward})` : ''}`));
  const hours = 40;
  for (let h = 1; h <= hours; h++) {
    for (let t = 0; t < TICKS_PER_HOUR; t++) sim.tick();
    const st = s.stats;
    const net = projectBudget(s.buildings, s.roads, s.tax, s.loans, st, emptyReport(), s.policies, s.metro).net;
    // The player reacts like a sensible newcomer.
    const goal = GOALS[s.goalsDone ?? 0]?.id;
    if (st.powerDemand > st.powerSupply * 0.85 && s.funds > 15000) place(FacilityKind.CoalPlant, 150 + 6 * h, 50);
    if (st.waterDemand > st.waterSupply * 0.85 && s.funds > 4000) place(FacilityKind.WaterTower, 135 + h, 70);
    if (goal === 'clinic' && s.funds > 8000) place(FacilityKind.Clinic, 160, 68);
    if (goal === 'school' && s.funds > 8000) place(FacilityKind.School, 175, 68);
    if (goal === 'council') sim.apply({ type: 'recordCouncilDecision' });
    if (h === 12 && s.funds > 6000) place(FacilityKind.Police, 150, 72);
    if (h === 14 && s.funds > 6000) place(FacilityKind.FireStation, 185, 72);
    if (goal === 'transit' && s.funds > 3000) for (const i of [140, 160, 180]) place(FacilityKind.BusStop, i, 73);
    if (s.funds < 3000 && s.loans.length < 2) sim.apply({ type: 'takeLoan', tier: s.loans.length });
    const free = stalledZones(sim);
    if (districts < 9 && zonedLand(sim)[1]!.ready < 40 && s.funds > 15000) district();
    const issues = detectIssues(sim).slice(0, 3).map((i) => `${i.kind}`).join(',');
    const b = projectBudget(s.buildings, s.roads, s.tax, s.loans, st, emptyReport(), s.policies, s.metro);
    if (h % 5 === 0) {
      const land = zonedLand(sim);
      log.push(`     land R ${JSON.stringify(land[1])} C ${JSON.stringify(land[2])} I ${JSON.stringify(land[3])}  water ${Math.round(st.waterDemand)}/${st.waterSupply}  unpowered ${st.unpowered} unwatered ${st.unwatered}  buildings ${s.buildings.filter((x) => x && x.kind === 0).length} constructing ${s.constructing.length}`);
    }
    if (h % 5 === 0) log.push(`     budget: income ${Math.round(b.income)} (R ${Math.round(b.taxR)} C ${Math.round(b.taxC)} I ${Math.round(b.taxI)}) roads ${Math.round(b.roads)} utilities ${Math.round(b.utilities)} services ${Math.round(b.services)} loans ${Math.round(b.loans)} transit ${Math.round(b.transit)}`);
    log.push(
      `h${String(h).padStart(2)} pop ${String(st.population).padStart(5)}  funds ${String(Math.round(s.funds)).padStart(7)}  net ${String(Math.round(net)).padStart(5)}/h  dem R${Math.round(st.demand[1] * 100)} C${Math.round(st.demand[2] * 100)} I${Math.round(st.demand[3] * 100)}  happy ${Math.round(st.happiness * 100)}%  jobs ${st.jobsC + st.jobsI}/${Math.round(st.population * 0.55)}  pw ${st.powerDemand.toFixed(0)}/${st.powerSupply}  goal ${(s.goalsDone ?? 0) + 1}  stalled ${free.join('') || '-'}  issues ${issues}`,
    );
  }
  writeFileSync('eval/runs/playtest.txt', log.join('\n'));
  console.log(log.join('\n'));
});
