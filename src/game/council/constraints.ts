import type { CouncilOption } from './options';

/**
 * The mayor's instruction, turned into rules code can enforce.
 *
 * The mayor types free text before a meeting ("Keep it under $5,000. Don't demolish
 * homes."). The text still goes to the agents as written, but a prompt is a request, not
 * a guarantee. So the parts of the instruction that are unambiguous are also parsed here,
 * by pattern, into constraints over each option's measured payload. An option that breaks
 * one is marked for every agent, and the guardrails will not let it be recommended while
 * an option that respects the instruction exists.
 *
 * Only what is recognised is enforced, and the mayor is shown exactly what was
 * recognised before the meeting starts.
 */
export type ConstraintId = 'max_cost' | 'max_hourly' | 'no_demolition' | 'no_displacement' | 'no_job_loss' | 'no_debt' | 'no_tax_rise' | 'no_polluter';

export interface Constraint {
  id: ConstraintId;
  /** For the money caps. */
  limit?: number;
  /** How it is shown to the mayor and the agents. */
  label: string;
}

const usd = (n: number): string => `$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

const NEGATION = /\b(?:no|not|don'?t|do not|never|without|avoid|zero|nobody|nothing)\b/i;
const CAP = /(?:under|below|less than|at most|no more than|not more than|max(?:imum)?(?: of)?|within|up ?to|cap(?:ped)? (?:at|of)|limit(?:ed)? (?:to|of)|budget (?:of|is))\s*(?:rs\.?|₹|\$)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k\b|thousand|lakh|lac)?(?=([^.;!?\n]{0,24}))/gi;

function amount(digits: string, unit: string | undefined): number {
  const n = Number(digits.replace(/,/g, ''));
  const u = unit?.toLowerCase();
  return u === 'k' || u === 'thousand' ? n * 1e3 : u === 'lakh' || u === 'lac' ? n * 1e5 : n;
}

/** Reads the enforceable parts of an instruction. Unrecognised text yields nothing. */
export function parseInstruction(note: string): Constraint[] {
  const out = new Map<ConstraintId, Constraint>();
  const add = (c: Constraint): void => {
    const prev = out.get(c.id);
    // Two caps of the same kind: the tighter one holds.
    if (!prev || (c.limit !== undefined && prev.limit !== undefined && c.limit < prev.limit)) out.set(c.id, c);
  };
  for (const m of note.matchAll(CAP)) {
    const limit = amount(m[1]!, m[2]);
    if (!Number.isFinite(limit) || limit < 0) continue;
    const hourly = /^\s*(?:an?|per|each|every|\/)\s*(?:hour|hr|month)|^\s*(?:hourly|monthly)|^\s*\/\s*(?:hr|mo)\b/i.test(m[3] ?? '');
    add(hourly ? { id: 'max_hourly', limit, label: `at most ${usd(limit)} an hour` } : { id: 'max_cost', limit, label: `upfront cost at most ${usd(limit)}` });
  }
  // Prohibitions: a negation, then what is prohibited, within the same sentence.
  for (const sentence of note.split(/[.;!?\n]+/)) {
    const neg = sentence.search(NEGATION);
    if (neg < 0) continue;
    const rest = sentence.slice(neg).toLowerCase();
    const homes = /\b(?:homes?|houses?|housing|residents?|famil(?:y|ies)|people)\b/.test(rest);
    const work = /\b(?:workplaces?|jobs?|shops?|business(?:es)?|factor(?:y|ies)|offices?)\b/.test(rest);
    if (/\b(?:demolish\w*|demolition|bulldoz\w*|knock(?:ing)? down|tear(?:ing)? down|destroy\w*)\b/.test(rest)) {
      if (homes && !work) add({ id: 'no_displacement', label: 'no homes demolished' });
      else if (work && !homes) add({ id: 'no_job_loss', label: 'no workplaces demolished' });
      else add({ id: 'no_demolition', label: 'nothing demolished' });
    }
    if (/\b(?:displac\w*|evict\w*|relocat\w*|homeless)\b/.test(rest)) add({ id: 'no_displacement', label: 'nobody displaced' });
    if (/\b(?:job loss(?:es)?|los\w+ (?:of )?jobs|jobs? (?:lost|cut)|unemploy\w*)\b/.test(rest)) add({ id: 'no_job_loss', label: 'no jobs lost' });
    if (/\b(?:loans?|debt|borrow\w*)\b/.test(rest)) add({ id: 'no_debt', label: 'no new debt' });
    if (/\btax(?:es)?\b/.test(rest) && /\b(?:rais\w*|ris\w*|increas\w*|hik\w*|higher|new|more)\b/.test(rest)) add({ id: 'no_tax_rise', label: 'no tax rise' });
    if (/\b(?:coal|pollut\w*)\b/.test(rest)) add({ id: 'no_polluter', label: 'no new polluter' });
  }
  hindi(note, add);
  return [...out.values()];
}

// Hindi, in Devanagari or in Latin letters (Hinglish). Hindi puts the verb last and the
// negation next to it ("ghar mat todo", "koi ghar nahi tootna chahiye"), so a sentence with
// a negation is searched whole rather than from the negation on. `\b` does not work on
// Devanagari in JavaScript, so those words are matched as plain substrings.
const HI_NEG = /(?:^|[^a-z])(?:mat|nahi|nahin|na|bina|mana)(?![a-z])|मत|नहीं|नही|ना |बिना|मना/i;
const HI_CAP = /(?:rs\.?|₹|\$)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k\b|thousand|lakh|lac|hazaa?r|लाख|हज़ार|हजार)?\s*(?:rupe\w*|रुपय?े|रुपए|dollars?)?\s*(?:se|से)\s*(kam|कम|zyada|jyada|ज़्यादा|ज्यादा|adhik|अधिक)/gi;

function hindi(note: string, add: (c: Constraint) => void): void {
  const unit = (u: string | undefined): string | undefined => (u && /लाख/.test(u) ? 'lakh' : u && /हज़ार|हजार|hazaa?r/i.test(u) ? 'thousand' : u);
  for (const sentence of note.split(/[.;!?\n।]+/)) {
    const s = sentence.toLowerCase();
    const neg = HI_NEG.test(s);
    for (const m of s.matchAll(HI_CAP)) {
      // "X se kam" is a cap; "X se zyada" is a cap only when forbidden ("... mat karo").
      if (!/kam|कम/.test(m[3]!) && !neg) continue;
      const limit = amount(m[1]!, unit(m[2]));
      const hourly = /ghant|घंट|per hour|an hour|hourly/.test(s);
      add(hourly ? { id: 'max_hourly', limit, label: `at most ${usd(limit)} an hour` } : { id: 'max_cost', limit, label: `upfront cost at most ${usd(limit)}` });
    }
    if (!neg) continue;
    const homes = /(?:^|[^a-z])(?:ghar|gharon|makaan|makan|log|logon|parivar)(?![a-z])|घर|मकान|लोग|परिवार/.test(s);
    const work = /(?:^|[^a-z])(?:dukaan|dukan|dukaanein|naukri|naukriyan|factory|daftar|office)(?![a-z])|दुकान|नौकरी|फैक्ट्री|दफ़्तर|दफ्तर/.test(s);
    if (/tod|toot|tut|gira|ujaad|ujad|तोड़|तोड|टूट|गिरा|उजाड़/.test(s)) {
      if (homes && !work) add({ id: 'no_displacement', label: 'no homes demolished' });
      else if (work && !homes) add({ id: 'no_job_loss', label: 'no workplaces demolished' });
      else add({ id: 'no_demolition', label: 'nothing demolished' });
    }
    if (/(?:^|[^a-z])(?:loan|karz|karza|karja|udhaar|udhar)(?![a-z])|कर्ज|क़र्ज़|कर्ज़|लोन|उधार/.test(s)) add({ id: 'no_debt', label: 'no new debt' });
    if (/(?:^|[^a-z])(?:tax|taxes)(?![a-z])|टैक्स|कर /.test(s) && /badh|badha|बढ़|बढा|ज़्यादा|ज्यादा|zyada/.test(s)) add({ id: 'no_tax_rise', label: 'no tax rise' });
    if (/pradushan|pollution|coal|koyla|प्रदूषण|कोयला/.test(s)) add({ id: 'no_polluter', label: 'no new polluter' });
    if (/(?:^|[^a-z])(?:naukri|naukriyan|rozgar)(?![a-z])|नौकरी|रोज़गार|रोजगार/.test(s) && /jaa|ja |chhin|khatam|जा|छिन|खत्म/.test(s) && !/tod|toot|gira|तोड़|गिरा/.test(s)) add({ id: 'no_job_loss', label: 'no jobs lost' });
  }
}

/** How an option breaks the mayor's instruction, in words; empty when it respects it. */
export function violations(option: CouncilOption, constraints: readonly Constraint[]): string[] {
  const e = option.effects;
  const out: string[] = [];
  for (const c of constraints) {
    switch (c.id) {
      case 'max_cost': {
        const spend = Math.max(0, -e.budgetDelta);
        if (spend > c.limit!) out.push(`costs ${usd(spend)}, over the ${usd(c.limit!)} limit`);
        break;
      }
      case 'max_hourly': {
        const hourly = Math.max(0, -e.hourlyNetDelta);
        if (hourly > c.limit!) out.push(`costs ${usd(hourly)} an hour, over the ${usd(c.limit!)} limit`);
        break;
      }
      case 'no_demolition':
        if (e.buildingsDemolished > 0 || e.residentsDisplaced > 0 || e.jobsLost > 0) out.push(`demolishes ${Math.max(1, e.buildingsDemolished)} building${e.buildingsDemolished > 1 ? 's' : ''}`);
        break;
      case 'no_displacement':
        if (e.residentsDisplaced > 0) out.push(`displaces ${e.residentsDisplaced} residents`);
        break;
      case 'no_job_loss':
        if (e.jobsLost > 0) out.push(`destroys ${e.jobsLost} jobs`);
        break;
      case 'no_debt':
        if (e.debtDelta > 0) out.push(`takes on ${usd(e.debtDelta)} of debt`);
        break;
      case 'no_tax_rise':
        if (e.taxRateDelta.some((d) => d > 0)) out.push('raises taxes');
        break;
      case 'no_polluter':
        if (option.impact.pollutes) out.push('adds a polluter near homes');
        break;
    }
  }
  return out;
}

/** Whether any option that actually does something respects the instruction. */
export function anyCompliant(options: readonly CouncilOption[], constraints: readonly Constraint[]): boolean {
  return options.some((o) => o.actions.length > 0 && violations(o, constraints).length === 0);
}
