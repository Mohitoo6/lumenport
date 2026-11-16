import { violations, type Constraint } from './constraints';
import type { FiscalLimits } from './effects';
import { MINISTER_BY_ID, type MinistryId } from './ministries';
import type { CouncilOption } from './options';
import type { ChairVerdict, MinisterTurn } from './schemas';

/**
 * Deterministic stand-in agents: each ministry's portfolio written as a scoring rule over
 * the options' measured effects, with a sentence built from the same numbers.
 *
 * They exist so the council never depends on the network. When the free tier is rate
 * limited, a reply does not fit its schema, or the player chooses the offline mode, the
 * turn is taken by the stand-in instead of being lost, at a cost of zero tokens. Whatever
 * they say is grounded by construction, because every figure is read from the payload.
 */

export type Lang = 'en' | 'hi';

const usd = (n: number): string => `$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

/** How much a ministry likes an option: its objective, as arithmetic. */
export function score(id: MinistryId, o: CouncilOption, constraints: readonly Constraint[] = []): number {
  const e = o.effects;
  const im = o.impact;
  // Doing something beats doing nothing, unless the portfolio says otherwise below.
  let v = o.actions.length > 0 ? 10 : 0;
  // The mayor's instruction outranks every portfolio.
  if (violations(o, constraints).length > 0) v -= 60;
  if (o.feasibility.status === 'unaffordable' || o.feasibility.status === 'blocked') v -= 100;
  else if (o.feasibility.status === 'needs_loan') v -= id === 'finance' ? 40 : 12;
  const spend = Math.max(0, -e.budgetDelta);
  const taxUp = e.taxRateDelta[0] + e.taxRateDelta[1] + e.taxRateDelta[2];
  switch (id) {
    case 'finance':
      v -= spend / 1000 + Math.max(0, -e.hourlyNetDelta) / 50 + e.debtDelta / 15000;
      v += Math.max(0, e.hourlyNetDelta) / 100;
      break;
    case 'welfare':
      v -= e.residentsDisplaced / 5 + e.jobsLost / 12 + taxUp * 0.8;
      v += e.approvalDelta * 2;
      break;
    case 'planning':
      v -= e.residentsDisplaced / 6 + e.buildingsDemolished / 2 + taxUp * 0.5 + (im.pollutes ? 5 : 0);
      break;
    case 'health':
      v -= (im.clinicM < 300 ? 6 : 0) + (im.pollutes ? 8 : 0) + e.residentsDisplaced / 20;
      v += e.approvalDelta;
      break;
    case 'education':
      v -= im.schoolM < 250 ? 6 : 0;
      break;
    case 'environment':
      v += (im.green ? 4 : 0) - (im.pollutes ? 10 : 0) - im.treesCleared / 5;
      break;
    case 'energy':
      v += e.powerSupplyDelta / 4 + e.waterSupplyDelta / 800 - (im.pollutes ? 2 : 0);
      break;
    case 'roads':
      v += e.trafficImpact.capacityDelta / 15 + (1 - e.trafficImpact.rushPeakFactor) * 12 + e.trafficImpact.transitRidersDelta / 40;
      break;
    case 'safety':
      v += e.trafficImpact.capacityDelta / 30 + (1 - e.trafficImpact.rushPeakFactor) * 6 + e.trafficImpact.transitRidersDelta / 80;
      break;
  }
  return v;
}

/** The one fact from a ministry's own lens that explains why it dislikes an option. */
function objection(id: MinistryId, o: CouncilOption, limits: FiscalLimits, hi: boolean, constraints: readonly Constraint[] = []): string {
  const e = o.effects;
  const broken = violations(o, constraints);
  if (broken.length) return hi ? `मेयर के निर्देश के ख़िलाफ़ है (${broken.join(', ')})` : `${broken.join(' and ')}, against the mayor's instruction`;
  const im = o.impact;
  const spend = Math.max(0, -e.budgetDelta);
  if (o.feasibility.status === 'unaffordable' || o.feasibility.status === 'needs_loan') {
    return hi ? `की लागत ${usd(spend)} है, जबकि खज़ाने में ${usd(limits.treasury)} ही हैं` : `costs ${usd(spend)} against a treasury of ${usd(limits.treasury)}`;
  }
  switch (id) {
    case 'finance':
      if (spend > 0) return hi ? `पर अभी ${usd(spend)} और हर घंटे ${usd(-e.hourlyNetDelta)} खर्च होते हैं` : `costs ${usd(spend)} now and ${usd(-e.hourlyNetDelta)} an hour`;
      if (e.debtDelta > 0) return hi ? `से ${usd(e.debtDelta)} का कर्ज़ चढ़ता है` : `adds ${usd(e.debtDelta)} of debt`;
      if (o.actions.length === 0) return hi ? 'से घाटा जस का तस रहता है' : 'leaves the deficit where it is';
      break;
    case 'welfare':
    case 'planning':
      if (e.residentsDisplaced > 0) return hi ? `से ${e.residentsDisplaced} निवासी बेघर होते हैं` : `puts ${e.residentsDisplaced} residents out of their homes`;
      if (e.jobsLost > 0) return hi ? `से ${e.jobsLost} नौकरियाँ जाती हैं` : `destroys ${e.jobsLost} jobs`;
      if (e.taxRateDelta[0] > 0) return hi ? `से घरों पर कर ${e.taxRateDelta[0]} अंक बढ़ता है` : `raises the tax on homes by ${e.taxRateDelta[0]} points`;
      break;
    case 'health':
      if (im.pollutes) return hi ? 'घरों के पास प्रदूषण बढ़ाता है' : 'adds a polluter near homes';
      if (im.clinicM < 300) return hi ? `क्लिनिक से ${Math.round(im.clinicM)} m पर ट्रैफ़िक लाता है` : `brings traffic within ${Math.round(im.clinicM)} m of a clinic`;
      break;
    case 'education':
      if (im.schoolM < 250) return hi ? `स्कूल से ${Math.round(im.schoolM)} m पर ट्रैफ़िक लाता है` : `brings traffic within ${Math.round(im.schoolM)} m of a school`;
      break;
    case 'environment':
      if (im.pollutes) return hi ? 'घरों के पास नया प्रदूषक जोड़ता है' : 'adds a new polluter near homes';
      if (im.treesCleared > 5) return hi ? `${im.treesCleared} भूखंडों के पेड़ काटता है` : `clears trees on ${im.treesCleared} plots`;
      break;
    case 'energy':
      if (e.powerSupplyDelta < 0) return hi ? `बिजली आपूर्ति ${-e.powerSupplyDelta} MW घटाता है` : `cuts power supply by ${-e.powerSupplyDelta} MW`;
      break;
    default:
      break;
  }
  if (o.actions.length === 0) return hi ? 'समस्या को वैसा ही छोड़ देता है' : 'leaves the problem as it is';
  return hi ? 'मेरे विभाग की प्राथमिकताओं के ख़िलाफ़ जाता है' : `cuts against ${MINISTER_BY_ID[id].short.toLowerCase()} priorities`;
}

/** The one fact from a ministry's own lens that explains why it accepts an option. */
function merit(id: MinistryId, o: CouncilOption, limits: FiscalLimits, hi: boolean): string {
  const e = o.effects;
  const spend = Math.max(0, -e.budgetDelta);
  switch (id) {
    case 'finance':
      if (spend === 0 && e.hourlyNetDelta > 0) return hi ? `से हर घंटे ${usd(e.hourlyNetDelta)} की बचत होती है` : `improves the hourly balance by ${usd(e.hourlyNetDelta)}`;
      if (spend === 0) return hi ? 'पर अभी कोई खर्च नहीं है' : 'costs nothing upfront';
      return hi ? `की लागत ${usd(spend)} है और खज़ाने में ${usd(limits.treasury)} हैं` : `costs ${usd(spend)}, which a treasury of ${usd(limits.treasury)} can carry`;
    case 'welfare':
    case 'planning':
      if (e.residentsDisplaced === 0 && e.jobsLost === 0) return hi ? 'से कोई बेघर नहीं होता' : 'displaces nobody';
      break;
    case 'environment':
      if (o.impact.green) return hi ? 'हरित विकल्प है' : 'is the green choice';
      break;
    case 'energy':
      if (e.powerSupplyDelta > 0) return hi ? `${e.powerSupplyDelta} MW बिजली जोड़ता है` : `adds ${e.powerSupplyDelta} MW of supply`;
      if (e.waterSupplyDelta > 0) return hi ? `${e.waterSupplyDelta.toLocaleString('en-US')} इकाई पानी जोड़ता है` : `adds ${e.waterSupplyDelta.toLocaleString('en-US')} water units`;
      break;
    case 'roads':
    case 'safety':
      if (e.trafficImpact.rushPeakFactor < 1) return hi ? 'भीड़ के समय का ट्रैफ़िक घटाता है' : `cuts the rush-hour peak to ${Math.round(e.trafficImpact.rushPeakFactor * 100)}% of today's`;
      if (e.trafficImpact.transitRidersDelta > 0) return hi ? `${e.trafficImpact.transitRidersDelta} निवासियों को कार से बस पर लाता है` : `takes ${e.trafficImpact.transitRidersDelta} residents out of their cars`;
      if (e.trafficImpact.capacityDelta > 0) return hi ? 'सड़क की क्षमता बढ़ाता है' : `adds room for about ${e.trafficImpact.capacityDelta} more vehicles`;
      break;
    default:
      break;
  }
  return hi ? 'मेरे विभाग की दृष्टि से ठीक है' : `works from the ${MINISTER_BY_ID[id].short.toLowerCase()} side`;
}

export interface PolicyContext {
  options: readonly CouncilOption[];
  limits: FiscalLimits;
  lang: Lang;
  /** Where the others stand so far: minister -> option. */
  positions?: ReadonlyMap<MinistryId, string>;
  /** The enforceable parts of the mayor's instruction. */
  constraints?: readonly Constraint[];
}

/** One minister's turn, decided by rule. */
export function policyTurn(id: MinistryId, round: 1 | 2, lead: boolean, ctx: PolicyContext): MinisterTurn {
  const { options, limits } = ctx;
  const hi = ctx.lang === 'hi';
  const rules = ctx.constraints ?? [];
  const rate = (o: CouncilOption): number => score(id, o, rules);
  const ranked = [...options].sort((a, b) => rate(b) - rate(a));
  const best = ranked[0]!;
  const acting = options.filter((o) => o.actions.length > 0);
  const worst = [...acting].sort((a, b) => rate(a) - rate(b))[0];
  // A ministry objects when an option on the table scores clearly worse than doing nothing.
  const objects = worst !== undefined && worst.id !== best.id && rate(worst) < 4;

  if (round === 2) {
    // Final position: move to the room's choice if it is nearly as good for this portfolio.
    const counts = new Map<string, number>();
    for (const [m, o] of ctx.positions ?? []) if (m !== id) counts.set(o, (counts.get(o) ?? 0) + 1);
    const room = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    const roomOption = options.find((o) => o.id === room);
    if (roomOption && roomOption.id !== best.id && rate(best) - rate(roomOption) < 3) {
      return {
        speak: true,
        stance: 'support',
        option: roomOption.id,
        say: hi ? `सहयोगियों की बात सुनकर मैं विकल्प ${roomOption.id} स्वीकार कर सकता हूँ; यह ${merit(id, roomOption, limits, true)}।` : `Having heard colleagues, I can accept option ${roomOption.id}: it ${merit(id, roomOption, limits, false)}.`,
        condition: '',
      };
    }
    return {
      speak: true,
      stance: lead ? 'propose' : objects ? 'oppose' : 'support',
      option: best.id,
      say: hi
        ? `मेरा रुख़ वही है: विकल्प ${best.id}।${objects ? ` विकल्प ${worst!.id} ${objection(id, worst!, limits, true, rules)}।` : ''}`
        : `My position stands: option ${best.id}.${objects ? ` Option ${worst!.id} ${objection(id, worst!, limits, false, rules)}.` : ''}`,
      condition: '',
    };
  }

  if (lead) {
    return {
      speak: true,
      stance: 'propose',
      option: best.id,
      say: hi ? `मेयर साहब, मेरा प्रस्ताव है विकल्प ${best.id}: ${best.title}। ${best.gist}` : `Mayor, I propose option ${best.id}, ${best.title.toLowerCase()}. ${best.gist}`,
      condition: '',
    };
  }
  if (objects) {
    return {
      speak: true,
      stance: 'concern',
      option: best.id,
      say: hi
        ? `विकल्प ${worst!.id} ${objection(id, worst!, limits, true, rules)}। मैं विकल्प ${best.id} का समर्थन करता हूँ, जो ${merit(id, best, limits, true)}।`
        : `Option ${worst!.id} ${objection(id, worst!, limits, false, rules)}. I back option ${best.id}, which ${merit(id, best, limits, false)}.`,
      condition: '',
    };
  }
  return {
    speak: true,
    stance: 'support',
    option: best.id,
    say: hi ? `विकल्प ${best.id} ${merit(id, best, limits, true)}। मैं इसका समर्थन करता हूँ।` : `Option ${best.id} ${merit(id, best, limits, false)}. I support it.`,
    condition: '',
  };
}

/** The chair's recommendation by rule: the best-backed option the city can actually afford. */
export function policyVerdict(options: readonly CouncilOption[], tally: Record<string, MinistryId[]>, lang: Lang, constraints: readonly Constraint[] = []): ChairVerdict {
  const hi = lang === 'hi';
  const affordable = options.filter((o) => o.feasibility.status === 'ok');
  const compliant = affordable.filter((o) => violations(o, constraints).length === 0);
  const allowed = compliant.some((o) => o.actions.length > 0) ? compliant : affordable;
  const pool = allowed.length ? allowed : [options[options.length - 1]!];
  const backing = (o: CouncilOption): number => tally[o.id]?.length ?? 0;
  const pick = [...pool].sort((a, b) => backing(b) - backing(a) || Number(b.actions.length > 0) - Number(a.actions.length > 0))[0]!;
  const names = (ms: MinistryId[]): string => ms.map((m) => MINISTER_BY_ID[m].short).join(', ');
  const others = Object.entries(tally).filter(([id, ms]) => id !== pick.id && ms.length > 0);
  const spend = Math.max(0, -pick.effects.budgetDelta);
  return {
    option: pick.id,
    summary: hi
      ? `परिषद विकल्प ${pick.id} (${pick.title}) की सिफ़ारिश करती है${backing(pick) ? `; ${names(tally[pick.id]!)} इसके पक्ष में हैं` : ''}। ${pick.gist}`
      : `The council recommends option ${pick.id}, ${pick.title.toLowerCase()}${backing(pick) ? `, backed by ${names(tally[pick.id]!)}` : ''}. ${pick.gist}${spend > 0 ? ` It costs ${usd(spend)} now.` : ''}`,
    dissent: others.length ? (hi ? others.map(([id, ms]) => `${names(ms)} विकल्प ${id} चाहते हैं`).join('; ') + '।' : others.map(([id, ms]) => `${names(ms)} would rather have option ${id}`).join('; ') + '.') : '',
    conditions: '',
  };
}
