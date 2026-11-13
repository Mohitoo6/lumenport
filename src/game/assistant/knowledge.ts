import { CELL } from '../../core/constants';
import { LOAN_TIERS } from '../../sim/economy/budget';
import { FACILITIES, FacilityKind } from '../../sim/facilities';
import { ROAD_SPECS, RoadType } from '../../sim/roads/types';
import { MAX_DEPTH } from '../../sim/zoning/lots';
import { METRO } from '../../sim/transit/metro';

/**
 * How the game works, written from the game's own numbers so the assistant's answers
 * cannot drift from the rules. Shared by every question; the city's live state is separate.
 */
export function gameManual(): string {
  const usd = (n: number): string => `$${n.toLocaleString('en-US')}`;
  const facilities = Object.entries(FACILITIES)
    .filter(([k]) => Number(k) !== FacilityKind.TownHall)
    .map(([, f]) => {
      const parts = [`${f.name}: ${usd(f.cost)}, ${usd(f.upkeep)}/month`];
      if (f.power) parts.push(`${f.power} MW`);
      if (f.water) parts.push(`${f.water.toLocaleString('en-US')} water units`);
      if (f.radius) parts.push(`reach ${f.radius * CELL} m`);
      if (f.needsShore) parts.push('must be next to open water');
      return `- ${parts.join(', ')}. ${f.blurb}`;
    })
    .join('\n');
  const street = ROAD_SPECS[RoadType.Street];
  const avenue = ROAD_SPECS[RoadType.Avenue];
  return `HOW THE GAME WORKS (Metropolis, a city builder; the player is the mayor)
Toolbar at the bottom: Street, Avenue, Homes, Shops, Industry, De-zone, Power, Water, Services, Bulldoze. Top bar: date, speed, funds, population, happiness, demand bars, clock, Council button, Views (data overlays), Menu (M).

Roads
- Street: ${usd(street.cost)} per metre, 2 lanes. Avenue: ${usd(avenue.cost)} per metre, 4 lanes with a median, carries far more traffic.
- Drag to draw; Curve mode in the road menu draws bends. Roads snap to angles and to other roads; crossing a road makes a junction.
- Roads must start and end on dry land; short spans over water become bridges. Very steep ground refuses a road. The town hall cannot be built over.
- Power and water travel along roads: a building is served only if its street is connected to a plant and a water source.

Zoning (Homes = residential, Shops = commercial, Industry = industrial; density low/medium/high)
- Painting zones is free. Buildings appear on their own, only where ALL of these hold:
  1. the zoned cell is within ${MAX_DEPTH} cells (${MAX_DEPTH * CELL} m) of a road, facing it;
  2. that street has spare power and spare water;
  3. there is demand for that zone type (demand bars in the top bar). Homes need jobs (Shops, Industry); Shops need customers (Homes); Industry needs workers (Homes);
  4. the ground is not too steep or under water.
- Zoning far from roads stays coloured and never builds. De-zone clears zoning.
- Buildings go through construction stages, then fill up. They upgrade to level 2-3 with higher land value (services, parks, low pollution and crime).

Utilities and services (place with the Power, Water and Services menus; every facility needs a road in front, except the town hall)
${facilities}
- Coal is cheap power but pollutes; wind and solar are clean but small. Pollution, crime and missing services lower happiness and land value.

Money
- Monthly income is taxes per zone type (Budget panel, B); spending is road upkeep and facility upkeep. Higher taxes lower demand.
- Loans: ${LOAN_TIERS.map((t) => `${usd(t.amount)} over ${t.months} months at ${Math.round(t.rate * 100)}%`).join('; ')}.
- Bulldozing gives no refund.

Traffic
- Rush hours are about 9:00 and 18:00. Fixes: avenues, extra parallel streets, more junctions, mixing homes and jobs closer together, or the staggered-hours policy via the council.

The city council
- When a problem lasts, the responsible minister asks for a meeting; the Council button in the top bar lists current problems. The council meets in the town hall, debates real options with costs, and the mayor approves one. Approved options are built automatically.

Metro (toolbar: Metro)
- Place Metro stations beside roads (Metro > Station), then draw a line (Metro > Line): click a station, click the ground to bend the line, click another station to build it. Cost ${usd(METRO.baseCost)} per line plus ${usd(METRO.costPerMetre)} per metre; upkeep ${usd(METRO.upkeepPerMetre)} per metre a month plus each station's upkeep.
- The line runs on a viaduct over roads, houses and small shops, but not through taller buildings or facilities: bend it around them.
- A station only works once a line joins it to another station. Residents within reach (about ${Math.round(FACILITIES[FacilityKind.MetroStation]!.radius * CELL)} m) ride instead of driving: fewer cars, higher land value and happiness, and fares as income. Bulldoze the ground under a line to remove it.

Campus (toolbar: Campus)
- IT park: well-paid office jobs (taxed more than shop jobs), which raise demand for homes.
- University: education cover over a very wide area, higher land value, and campus jobs.

Zoning tip: the Zone tool's "Along road" brush (default) zones both sides of any road you drag along, straight, curved or zigzag; "Area" paints a rectangle.

Views (top right) colour the map by power, water, traffic, pollution, crime, land value, happiness, police/fire/health/education cover and metro reach.
Controls: WASD or arrows move, Q/E rotate, R/F tilt, scroll zooms, right-drag orbits, Space pauses, 1-3 set speed, Esc cancels a tool, B budget, V views, M menu (save, load, new city, graphics, sound).`;
}
