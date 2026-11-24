import { FacilityKind, FACILITIES, Service } from './facilities';
import type { GameState } from './state';
import { ZoneType, zoneType } from './zoning/zones';

/**
 * The city's goals: a short chain that teaches a new player the game (street, homes,
 * power, water) and then sets population milestones, with a cash grant for each one.
 *
 * Goals are checked in order, one at a time, by plain code on the saved state, so they
 * are deterministic and travel with a save. Sandbox cities reach them too, but get no
 * grant (their money is unlimited).
 */
export interface Goal {
  id: string;
  title: string;
  /** What to do, in one line, naming the tool to use. */
  hint: string;
  /** Grant paid when the goal is reached (not in sandbox). */
  reward: number;
  /** [now, target] for goals with a number to reach; target 1 for yes/no goals. */
  progress: (s: GameState) => [number, number];
}

const has = (s: GameState, f: (kind: number) => boolean): boolean => s.buildings.some((b) => b !== null && b.kind !== 0 && b.progress >= 1 && f(b.kind));
const flag = (v: boolean): [number, number] => [v ? 1 : 0, 1];
const pop = (target: number) => (s: GameState): [number, number] => [s.stats.population, target];

export const GOALS: readonly Goal[] = [
  { id: 'street', title: 'Lay your first street', hint: 'Pick Street in the toolbar, then click and drag on the map.', reward: 0, progress: (s) => flag(s.roads.edges.some((e) => e !== null)) },
  {
    id: 'homes',
    title: 'Zone homes beside it',
    hint: 'Pick Homes and drag along the street. Houses grow on their own.',
    reward: 0,
    progress: (s) => flag(s.zone.some((z) => z !== 0 && zoneType(z) === ZoneType.Residential)),
  },
  { id: 'power', title: 'Switch on the power', hint: 'Power: place a plant beside a road on the same network as the homes.', reward: 0, progress: (s) => flag(s.sandbox || s.stats.powerSupply > 0) },
  { id: 'water', title: 'Turn on the water', hint: 'Water: place a water tower beside a road.', reward: 0, progress: (s) => flag(s.sandbox || s.stats.waterSupply > 0) },
  { id: 'residents100', title: 'Welcome 100 residents', hint: 'Keep zoning homes along served streets.', reward: 3000, progress: pop(100) },
  {
    id: 'jobs',
    title: 'Create 60 jobs',
    hint: 'Zone Shops and Industry: homes stop growing without jobs.',
    reward: 3000,
    progress: (s) => [Math.round(s.stats.jobsC + s.stats.jobsI), 60],
  },
  { id: 'clinic', title: 'Build a clinic', hint: 'Services → Clinic. Health cover keeps residents happy.', reward: 2500, progress: (s) => flag(has(s, (k) => FACILITIES[k]?.service === Service.Health)) },
  { id: 'town500', title: 'Grow into a town: 500 residents', hint: 'Balance the demand bars: homes, shops and industry.', reward: 6000, progress: pop(500) },
  { id: 'school', title: 'Open a school', hint: 'Services → School. Education lifts land value, so buildings upgrade.', reward: 3000, progress: (s) => flag(has(s, (k) => FACILITIES[k]?.service === Service.Education)) },
  {
    id: 'council',
    title: 'Take a problem to the council',
    hint: 'Open Council, call the ministers on a problem and approve the option you like.',
    reward: 4000,
    progress: (s) => flag((s.councilDecisions ?? 0) > 0),
  },
  { id: 'city2000', title: 'Become a city: 2,000 residents', hint: 'Medium-density zones hold four times as many people.', reward: 12000, progress: pop(2000) },
  {
    id: 'happy',
    title: 'A happy city: 60% happiness',
    hint: 'Cover homes with police, fire, clinics and schools; keep industry and jams away.',
    reward: 8000,
    progress: (s) => [Math.round(s.stats.happiness * 100), 60],
  },
  {
    id: 'transit',
    title: 'Get 100 people onto public transport',
    hint: 'Transit: bus stops along busy streets, or a metro line between districts.',
    reward: 6000,
    progress: (s) => [Math.round((s.stats.busRiders ?? 0) + (s.stats.metroRiders ?? 0)), 100],
  },
  { id: 'city5000', title: 'A big city: 5,000 residents', hint: 'High-density towers, offices and an IT park.', reward: 20000, progress: pop(5000) },
  { id: 'airport', title: 'Open an airport', hint: 'Transit → Airport: exports, tourists and trips for residents.', reward: 15000, progress: (s) => flag(has(s, (k) => k === FacilityKind.Airport)) },
  { id: 'metropolis', title: 'Mahanagar: 10,000 residents', hint: 'You have built a mahanagar, a great city. Keep it running.', reward: 40000, progress: pop(10000) },
];

/** The goal being worked on, or null when all are done. */
export function currentGoal(s: GameState): Goal | null {
  return GOALS[s.goalsDone ?? 0] ?? null;
}

export function goalMet(goal: Goal, s: GameState): boolean {
  const [now, target] = goal.progress(s);
  return now >= target;
}

/**
 * Completes every goal in a row that is already met (a loaded city can pass several at
 * once), paying their grants. Returns the goals reached, in order.
 */
export function advanceGoals(s: GameState): Goal[] {
  const reached: Goal[] = [];
  for (let g = currentGoal(s); g && goalMet(g, s); g = currentGoal(s)) {
    s.goalsDone = (s.goalsDone ?? 0) + 1;
    if (!s.sandbox) s.funds += g.reward;
    reached.push(g);
  }
  return reached;
}
