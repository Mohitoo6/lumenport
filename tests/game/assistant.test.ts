import { describe, expect, it } from 'vitest';
import { offlineReply, parseAssistantReply, scriptOf, validActions } from '../../src/game/assistant/assistant';
import { AssistantController, type Completer } from '../../src/game/assistant/controller';
import { gameManual } from '../../src/game/assistant/knowledge';
import { citySituation, zonedLand } from '../../src/game/assistant/situation';
import { FacilityKind } from '../../src/sim/facilities';
import { RoadType } from '../../src/sim/roads/types';
import { Sim } from '../../src/sim/sim';
import { ZoneType, zoneCode } from '../../src/sim/zoning/zones';
import { ui } from '../../src/ui/store';

/** A street with homes zoned beside it and more homes zoned far from any road; no power or water. */
function starterTown(): Sim {
  const sim = Sim.create(1337);
  sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: 1040, az: 584, bx: 1300, bz: 584 });
  sim.apply({ type: 'zoneRect', x0: 131, y0: 74, x1: 160, y1: 76, zone: zoneCode(ZoneType.Residential, 1) });
  sim.apply({ type: 'zoneRect', x0: 131, y0: 100, x1: 140, y1: 104, zone: zoneCode(ZoneType.Residential, 1) });
  for (let i = 0; i < 400; i++) sim.tick();
  return sim;
}

const host = (sim: Sim) => ({ sim, issues: () => [{ key: 'traffic:3', title: 'Gridlock on Canal Street', severity: 0.8 }], tool: () => 'none', hour: () => 9 });

describe('assistant: what it is told', () => {
  it('describes the rules from the game’s own numbers', () => {
    const m = gameManual();
    expect(m).toContain('within 4 cells (32 m) of a road');
    expect(m).toContain('Clinic: $6,000, $380/month');
    expect(m).not.toContain('Town Hall:');
  });

  it('sees why zoned land is not building: no utilities by the road, too far from the road', () => {
    const sim = starterTown();
    const land = zonedLand(sim)[ZoneType.Residential]!;
    expect(land.unserved).toBeGreaterThan(0);
    expect(land.noRoad).toBeGreaterThan(0);
    expect(land.ready).toBe(0);
    const text = citySituation(sim, { refusals: [], issues: [], tool: 'none', hour: 9 });
    expect(text).toMatch(/No power/);
    expect(text).toMatch(/cells too far from any road/);
  });

  it('remembers what the game refused, with the game’s reason', () => {
    const sim = starterTown();
    const c = new AssistantController(host(sim), async () => null);
    // A facility needs a road in front; far from any road it is refused.
    const r = sim.apply({ type: 'placeFacility', kind: FacilityKind.Clinic, x: 20, y: 20 });
    expect(r.ok).toBe(false);
    c.noteCommand({ type: 'placeFacility', kind: FacilityKind.Clinic, x: 20, y: 20 }, r);
    expect(c.refusals[0]!.what).toBe('placing a Clinic');
    expect(c.prompt('why can’t I build a clinic?').user).toContain(r.reason!);
  });
});

describe('assistant: what it may offer', () => {
  const issues = [{ key: 'traffic:3', title: 'Gridlock', severity: 0.8 }];
  it('keeps only real actions', () => {
    const acts = validActions(
      [
        { type: 'council', issue: 'traffic:3', label: 'Call the council' },
        { type: 'council', issue: 'made-up', label: 'Fake' },
        { type: 'tool', tool: 'place', facility: FacilityKind.TownHall, label: 'Build a town hall' },
        { type: 'tool', tool: 'teleport', label: 'Nope' },
        { type: 'view', overlay: 'magic', label: 'Nope' },
        { type: 'tool', tool: 'place', facility: FacilityKind.WaterTower, label: 'Water tower' },
        { type: 'view', overlay: 'power', label: 'Power view' },
        { type: 'budget', label: 'Budget' },
      ],
      issues,
    );
    expect(acts.map((a) => a.label)).toEqual(['Call the council', 'Water tower', 'Power view']);
  });

  it('parses a model reply and rejects an empty one', () => {
    expect(parseAssistantReply('{"answer":"Build a water tower.","actions":[{"type":"budget","label":"Budget"}]}', issues, 'm')!.actions).toHaveLength(1);
    expect(parseAssistantReply('not json', issues, 'm')).toBeNull();
  });

  it('falls back to the city’s warnings without the AI, in the player’s script', () => {
    const r = offlineReply(['No power: build a power plant beside a road'], issues, true);
    expect(r.answer).toContain('AI अभी उपलब्ध नहीं');
    expect(r.answer).toContain('No power');
    expect(r.actions[0]).toMatchObject({ type: 'council', issue: 'traffic:3' });
  });
});

describe('assistant: language and fallback', () => {
  it('tells Hinglish from English and Hindi', () => {
    expect(scriptOf('ghar kyu nahi ban rahe? kya karu?')).toBe('hinglish');
    expect(scriptOf('Why are my homes not being built?')).toBe('english');
    expect(scriptOf('घर क्यों नहीं बन रहे?')).toBe('devanagari');
  });

  it('answers the question asked when offline: money gets the budget, not unrelated warnings', () => {
    const r = offlineReply(['Water shortage'], [{ key: 'water:1', title: 'Water shortage', severity: 0.9 }], false, 'Why is my money going down?', { money: '$4,000 in hand, -$900 a month' });
    expect(r.answer).toContain('-$900 a month');
    expect(r.answer).not.toContain('Water');
    expect(r.actions[0]!.type).toBe('budget');
    const t = offlineReply(['Water shortage'], [{ key: 'water:1', title: 'Water shortage', severity: 0.9 }, { key: 'traffic:2', title: 'Gridlock on Canal Street', severity: 0.6 }], false, 'traffic is bad');
    expect(t.answer).toContain('Gridlock');
    expect(t.actions[0]).toMatchObject({ type: 'council', issue: 'traffic:2' });
  });
});

describe('assistant: conversation', () => {
  it('answers through the model, keeps history, and survives a broken reply', async () => {
    const sim = starterTown();
    const seen: string[] = [];
    let calls = 0;
    const completer: Completer = async (_s, user) => {
      seen.push(user);
      calls++;
      if (calls === 2) return { text: 'garbage', provider: 'x' };
      return { text: JSON.stringify({ answer: `Answer ${calls}`, actions: [{ type: 'tool', tool: 'place', facility: FacilityKind.WaterTower, label: 'Water tower' }] }), provider: 'test-model' };
    };
    const c = new AssistantController(host(sim), completer);
    c.retryMs = 0;
    await c.ask('Why are homes not built?');
    expect(ui.assistant.value.messages.map((m) => m.text)).toEqual(['Why are homes not built?', 'Answer 1']);
    expect(ui.assistant.value.messages[1]!.actions![0]!.label).toBe('Water tower');
    // Second question: the first reply is garbage, the retry works; history is in the prompt.
    const r = await c.answer('And then?');
    expect(r.answer).toBe('Answer 3');
    expect(seen[2]).toContain('Assistant: Answer 1');
    const quiet = new AssistantController(host(sim), async () => null);
    quiet.retryMs = 0;
    const offline = await quiet.answer('help');
    expect(offline.source).toBe('offline');
  });
});
