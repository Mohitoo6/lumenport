import { CELL } from '../../core/constants';
import { LOAN_TIERS } from '../../sim/economy/budget';
import { FACILITIES, FacilityKind } from '../../sim/facilities';
import { ROAD_SPECS, RoadType } from '../../sim/roads/types';
import { MAX_DEPTH } from '../../sim/zoning/lots';
import { BUS } from '../../sim/transit/bus';
import { METRO } from '../../sim/transit/metro';

/**
 * How the game works, written from the game's own numbers so the assistant's answers
 * cannot drift from the rules.
 *
 * The manual is kept as sections, each with the words a question about it would use.
 * A question is answered with only the sections it touches (`manualFor`): retrieval by
 * keyword, in code. That roughly halves the prompt compared with sending the whole
 * manual every time, costs no model call, and can be tested exactly.
 */
export interface ManualSection {
  id: string;
  /** Words (English, Hindi, Hinglish) that mark a question as being about this section. */
  about: RegExp;
  text: string;
}

const usd = (n: number): string => `$${n.toLocaleString('en-US')}`;

const INTRO = `HOW THE GAME WORKS (Metropolis, a city builder; the player is the mayor)
Toolbar at the bottom: Street, Avenue, Homes, Shops, Industry, De-zone, Power, Water, Services, Campus, Transit, Bulldoze. Top bar: date, speed, funds, population, happiness, demand bars, clock, Council button, Views (data overlays), Menu (M).
Time: one game hour takes a real minute at normal speed (speeds 2 and 3 are twice and four times as quick). The budget settles every hour, so every income and upkeep figure is per hour. A day is 24 hours with a rush at about 9:00 and 18:00. The calendar is the Indian one: each day stands for a month, and two months make a season.`;

export function manualSections(): ManualSection[] {
  const facilities = Object.entries(FACILITIES)
    .filter(([k]) => Number(k) !== FacilityKind.TownHall)
    .map(([, f]) => {
      const parts = [`${f.name}: ${usd(f.cost)}, ${usd(f.upkeep)}/hour`];
      if (f.power) parts.push(`${f.power} MW`);
      if (f.water) parts.push(`${f.water.toLocaleString('en-US')} water units`);
      if (f.radius) parts.push(`reach ${f.radius * CELL} m`);
      if (f.needsShore) parts.push('must be next to open water');
      return `- ${parts.join(', ')}. ${f.blurb}`;
    })
    .join('\n');
  const street = ROAD_SPECS[RoadType.Street];
  const avenue = ROAD_SPECS[RoadType.Avenue];
  return [
    {
      id: 'roads',
      about: /road|street|avenue|bridge|junction|curve|lane|sadak|सड़क|रोड|पुल/i,
      text: `Roads
- Street: ${usd(street.cost)} per metre, 2 lanes. Avenue: ${usd(avenue.cost)} per metre, 4 lanes with a median, carries far more traffic.
- Drag to draw; Curve mode in the road menu draws bends. Roads snap to angles and to other roads; crossing a road makes a junction.
- Roads must start and end on dry land; short spans over water become bridges. Very steep ground refuses a road. The town hall cannot be built over.
- Power and water travel along roads: a building is served only if its street is connected to a plant and a water source.`,
    },
    {
      id: 'zoning',
      about: /zon|home|house|shop|industr|factor|build|grow|demand|density|empty|ghar|dukaan|bana|badh|घर|दुकान|उद्योग|बन|बढ़|शहर/i,
      text: `Zoning (Homes = residential, Shops = commercial, Industry = industrial; density low/medium/high)
- Painting zones is free. Buildings appear on their own, only where ALL of these hold:
  1. the zoned cell is within ${MAX_DEPTH} cells (${MAX_DEPTH * CELL} m) of a road, facing it;
  2. that street has spare power and spare water;
  3. there is demand for that zone type (demand bars in the top bar). Homes need jobs (Shops, Industry); Shops need customers (Homes); Industry needs workers (Homes);
  4. the ground is not too steep or under water.
- Zoning far from roads stays coloured and never builds. De-zone clears zoning.
- Buildings go through construction stages, then fill up. They upgrade to level 2-3 with higher land value (services, parks, low pollution and crime).
- The Zone tool's "Along road" brush (default) zones both sides of any road you drag along, straight, curved or zigzag; "Area" paints a rectangle.`,
    },
    {
      id: 'utilities',
      about: /power|electric|water|plant|coal|wind|solar|tower|pump|clinic|hospital|school|police|fire|park|service|facilit|pollut|crime|happi|bijli|paani|pani|बिजली|पानी|स्कूल|अस्पताल|पुलिस|प्रदूषण|खुश/i,
      text: `Utilities and services (place with the Power, Water and Services menus; every facility needs a road in front, except the town hall)
${facilities}
- Coal is cheap power but pollutes; wind and solar are clean but small. Pollution, crime and missing services lower happiness and land value.`,
    },
    {
      id: 'money',
      about: /money|fund|budget|tax|loan|debt|cost|price|deficit|income|expens|afford|refund|paisa|paise|kharch|karz|पैस|बजट|टैक्स|कर्ज|खर्च/i,
      text: `Money
- Hourly income is taxes per zone type (Budget panel, B); spending is road upkeep and facility upkeep. Higher taxes lower demand.
- Loans: ${LOAN_TIERS.map((t) => `${usd(t.amount)} over ${t.hours} hours at ${Math.round(t.rate * 100)}%`).join('; ')}.
- Bulldozing gives no refund.`,
    },
    {
      id: 'traffic',
      about: /traffic|jam|congest|gridlock|rush|car|commut|ट्रैफिक|जाम|गाड़/i,
      text: `Traffic
- Rush hours are about 9:00 and 18:00. Fixes: avenues, extra parallel streets, more junctions, mixing homes and jobs closer together, or the staggered-hours policy via the council.`,
    },
    {
      id: 'council',
      about: /council|minister|meeting|town hall|parishad|mantri|परिषद|मंत्री|बैठक/i,
      text: `The city council
- When a problem lasts, the responsible minister asks for a meeting; the Council button in the top bar lists current problems. The council meets in the town hall, debates real options with costs, and the mayor approves one. Approved options are built automatically.`,
    },
    {
      id: 'metro',
      about: /metro|station|train|transit|viaduct|bus|stop|airport|flight|plane|export|touris|travel|मेट्रो|ट्रेन|बस|हवाई/i,
      text: `Transit (toolbar: Transit)
- Bus stop: ${usd(FACILITIES[FacilityKind.BusStop]!.cost)}, placed beside a road. Two or more stops on connected roads start a bus line on their own; each line runs about one bus per two stops at ${usd(BUS.upkeepPerBus)}/hour a bus. Residents within about ${Math.round(FACILITIES[FacilityKind.BusStop]!.radius * CELL)} m of a served stop take the bus instead of driving (fewer cars, fares as income). Click a stop to see its line, or why it is not served.
- Metro: place stations beside roads (Transit > Metro station), then draw a line (Transit > Metro line): click a station, click the ground to bend the line, click another station. Cost ${usd(METRO.baseCost)} per line plus ${usd(METRO.costPerMetre)} per metre; upkeep ${usd(METRO.upkeepPerMetre)} per metre an hour plus each station's. The viaduct passes over roads, houses and small shops, not taller buildings or facilities. Residents within about ${Math.round(FACILITIES[FacilityKind.MetroStation]!.radius * CELL)} m of a connected station ride instead of driving.
- Airport: ${usd(FACILITIES[FacilityKind.Airport]!.cost)}, one per city, a long flat site (${FACILITIES[FacilityKind.Airport]!.size} by ${FACILITIES[FacilityKind.Airport]!.length} cells) beside a road. It earns from exports (per industrial worker), passenger fees (per resident) and tourists (per shop and office worker), raises demand for shops and industry, and gives ${FACILITIES[FacilityKind.Airport]!.jobs} jobs. Aircraft noise pollutes the land around it: keep homes away from the runway.`,
    },
    {
      id: 'campus',
      about: /campus|it park|universit|office job|college|विश्वविद्यालय|कॉलेज/i,
      text: `Campus (toolbar: Campus)
- IT park: well-paid office jobs (taxed more than shop jobs), which raise demand for homes.
- University: education cover over a very wide area, higher land value, and campus jobs.`,
    },
    {
      id: 'controls',
      about: /view|overlay|control|key|camera|zoom|rotate|save|load|menu|pause|speed|sound|graphics|how do i (?:move|look|turn)/i,
      text: `Views (top right) colour the map by power, water, traffic, pollution, crime, land value, happiness, police/fire/health/education cover and metro reach.
Controls: WASD or arrows move, Q/E rotate, R/F tilt, scroll zooms, right-drag orbits, Space pauses, 1-3 set speed, Esc cancels a tool, B budget, V views, M menu (save, load, new city, graphics, sound).`,
    },
  ];
}

/** The whole manual: every section. */
export function gameManual(): string {
  return [INTRO, ...manualSections().map((s) => s.text)].join('\n\n');
}

/** A city that is not growing is almost always a zoning, utilities or money matter. */
const CORE = ['zoning', 'utilities', 'money'];
const MAX_SECTIONS = 4;

/**
 * The parts of the manual a question needs. Sections are ranked by how many of their
 * words the question (and the city's current warnings) use; a question that names nothing
 * gets the core loop. Returns the text and which sections were chosen, for telemetry.
 */
export function manualFor(question: string, hints = ''): { text: string; sections: string[] } {
  const all = manualSections();
  const count = (re: RegExp, s: string): number => (s.match(new RegExp(re.source, 'gi')) ?? []).length;
  const scored = all
    .map((s, order) => ({ s, order, score: count(s.about, question) * 2 + Math.min(1, count(s.about, hints)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order);
  let chosen = scored.slice(0, MAX_SECTIONS).map((x) => x.s.id);
  // Nothing named (for example "what next?"): the core loop.
  if (!scored.some((x) => count(x.s.about, question) > 0)) chosen = [...new Set([...CORE, ...chosen])].slice(0, MAX_SECTIONS);
  // Why something is not building always involves utilities: rule 2 of zoning.
  if (chosen.includes('zoning') && !chosen.includes('utilities')) chosen = [...chosen.slice(0, MAX_SECTIONS - 1), 'utilities'];
  const picked = all.filter((s) => chosen.includes(s.id));
  return { text: [INTRO, ...picked.map((s) => s.text)].join('\n\n'), sections: picked.map((s) => s.id) };
}
