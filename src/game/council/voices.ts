import type { CityIssue, IssueKind } from './issues';

/**
 * What residents say about the city, and how a minister asks the mayor for a meeting.
 * Written from templates (no AI call), so the city feels alive for free; the council
 * meeting is where the model is used.
 */

const PEOPLE: Array<[name: string, handle: string]> = [
  ['Priya R.', 'priya_r'],
  ['Tom Becker', 'tombeck'],
  ['Arjun', 'arjun.codes'],
  ['Sana Qureshi', 'sanaq'],
  ['Marco', 'marco_bikes'],
  ['Deepa Nair', 'deepa.n'],
  ['Lucas', 'lucas_h'],
  ['Fatima', 'fatimak'],
  ['Rahul Verma', 'rahulv'],
  ['Emma Clarke', 'emmac'],
  ['Kabir', 'kabir_k'],
  ['Ayesha', 'ayesha.m'],
  ['Neil D.', 'neild'],
  ['Mrs. Gupta', 'gupta_aunty'],
];

const COMPLAINTS: Record<IssueKind, string[]> = {
  traffic: [
    '{place} again. 25 minutes to move two blocks. Who designed this?',
    'Stuck on {place} for the third evening running. Buses would be nice, just saying.',
    'Honking symphony on {place} right now. My ears.',
    'Left work at 6, still not home. {place} is a car park.',
    'Ambulance stuck behind traffic on {place}. That should never happen.',
  ],
  power: ['Power cut AGAIN. Fridge is warm, laptop is dead.', 'Lights flickering all evening. Does the city know?', 'No electricity on our street since morning. Shops shutting early.'],
  water: ['Taps are dry. Second day.', 'Water pressure is a joke. Anyone else?', 'Bought bottled water to cook dinner. In 2030.'],
  pollution: ['You can taste the air near the factories. Kids are coughing.', 'Smog over the neighbourhood again. Windows stay shut.', 'Washing came off the line grey. Thanks, chimneys.'],
  crime: ['Second break-in on our street this hour. Where are the police?', 'Not walking home after dark any more.', 'Bike stolen from right outside my door.'],
  health: ['Nearest clinic is miles away. Had to take a sick day just to see a doctor.', 'My mother needs check-ups and there is no clinic anywhere near us.', 'A city this size with no clinic? Really?'],
  education: ['No school nearby, so it is an hour of driving every morning.', 'Where are the kids supposed to study? No school in our area.', 'Thinking of moving. We need a school close by.'],
  fire: ['A kitchen fire next door and the fire brigade took forever.', 'Is there even a fire station in this part of town?'],
  budget: ['Heard the city is running out of money. Should we be worried?', 'Potholes everywhere and the council says the budget is tight.'],
  jobs: ['Six hours looking for work. Nothing in this city.', 'All my friends are leaving for jobs elsewhere.', 'Lots of new houses, no jobs to pay for them.'],
  housing: ['Trying to rent here is impossible. Nothing available.', 'Waiting list for a flat is a year long.'],
};

const GOOD = [
  'Lovely evening for a walk downtown.',
  'New shop opened on our street. Great coffee!',
  'Watching the city grow from my balcony. Proud of this place.',
  'Commute was quick today. Nice.',
  'Sunset over the river was something else tonight.',
  'Neighbours are friendly, rent is fair. Happy here.',
];

export type Mood = 'angry' | 'worried' | 'happy';

export interface Post {
  id: number;
  name: string;
  handle: string;
  text: string;
  mood: Mood;
  /** Issue it is about, if any: clicking it opens that issue. */
  issueKey?: string;
}

let nextId = 1;

function pick<T>(list: readonly T[], r: number): T {
  return list[Math.floor(r * list.length) % list.length]!;
}

/** A resident's post about an issue, or a contented one if `issue` is null. */
export function makePost(issue: CityIssue | null, r1: number, r2: number): Post {
  const [name, handle] = pick(PEOPLE, r1);
  if (!issue) return { id: nextId++, name, handle, text: pick(GOOD, r2), mood: 'happy' };
  const place = issue.kind === 'traffic' ? issue.title.replace(/^Gridlock on /, '') : 'our street';
  const text = pick(COMPLAINTS[issue.kind], r2).replace('{place}', place);
  return { id: nextId++, name, handle, text, mood: issue.severity > 0.7 ? 'angry' : 'worried', issueKey: issue.key };
}

/** What the lead minister says when asking the mayor for a meeting. */
export function requestText(issue: CityIssue): string {
  switch (issue.kind) {
    case 'traffic':
      return `Mayor, ${issue.summary} Residents are furious. I would like the council to agree a fix.`;
    case 'power':
    case 'water':
      return `Mayor, ${issue.summary} We need to decide on new supply before more streets go dark.`;
    case 'pollution':
      return `Mayor, ${issue.summary} I am asking for a council meeting on air quality.`;
    case 'crime':
      return `Mayor, ${issue.summary} I want the council behind a response.`;
    case 'budget':
      return `Mayor, ${issue.summary} We have to act before the treasury runs dry.`;
    default:
      return `Mayor, ${issue.summary} May I bring this to the council?`;
  }
}
