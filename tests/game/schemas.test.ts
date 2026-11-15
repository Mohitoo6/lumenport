import { describe, expect, it } from 'vitest';
import { checkNumbers, numbersIn } from '../../src/game/council/grounding';
import { SAY_MAX, chairVerdictSchema, jsonSchemaOf, ministerTurnSchema, parseChairVerdict, parseMinisterTurn } from '../../src/game/council/schemas';

const IDS = ['A', 'B', 'C'];

describe('structured output: ministers', () => {
  it('passes a reply that fits the contract untouched', () => {
    const r = parseMinisterTurn('{"speak":true,"stance":"support","option":"B","say":"I back option B.","condition":""}', IDS);
    expect(r.outcome).toBe('pass');
    expect(r.repairs).toEqual([]);
    expect(r.data).toEqual({ speak: true, stance: 'support', option: 'B', say: 'I back option B.', condition: '' });
  });

  it('repairs what can be fixed without changing the meaning, and says what it fixed', () => {
    const raw = 'Here you go:\n```json\n{"speak":"true","stance":"SUPPORT","option":"Option b","statement":"I back option B.","mood":"calm"}\n```';
    const r = parseMinisterTurn(raw, IDS);
    expect(r.outcome).toBe('repaired');
    expect(r.data).toEqual({ speak: true, stance: 'support', option: 'B', say: 'I back option B.', condition: '' });
    const fixes = r.repairs.join(' | ');
    expect(fixes).toMatch(/removed text around/);
    expect(fixes).toMatch(/renamed "statement" to "say"/);
    expect(fixes).toMatch(/dropped unknown field "mood"/);
    expect(fixes).toMatch(/"speak" was not a boolean/);
  });

  it('never lets an invented option through', () => {
    const r = parseMinisterTurn('{"speak":true,"stance":"propose","option":"F","say":"Build a monorail.","condition":""}', IDS);
    expect(r.outcome).toBe('repaired');
    expect(r.data!.option).toBe('none');
    expect(r.repairs.join(' ')).toMatch(/"F" is not on the table/);
  });

  it('cuts an overlong statement at a sentence end', () => {
    const long = `${'This is a sentence about the road. '.repeat(40)}`;
    const r = parseMinisterTurn(JSON.stringify({ speak: true, stance: 'support', option: 'A', say: long, condition: '' }), IDS);
    expect(r.outcome).toBe('repaired');
    expect(r.data!.say.length).toBeLessThanOrEqual(SAY_MAX);
    expect(r.data!.say.endsWith('.')).toBe(true);
  });

  it('fails what cannot be repaired', () => {
    expect(parseMinisterTurn('I think we should widen the road.', IDS).outcome).toBe('fail');
    expect(parseMinisterTurn('{"speak":true,"stance":"support","option":"A","say":42,"condition":""}', IDS).outcome).toBe('fail');
    expect(parseMinisterTurn('{"speak": true, "stance": "support", "option": "A", "say": "cut off mid', IDS).outcome).toBe('fail');
  });
});

describe('structured output: the chair', () => {
  it('accepts a valid recommendation and fills optional notes', () => {
    const r = parseChairVerdict('{"option":"option c","summary":"Most ministers back C."}', IDS);
    expect(r.outcome).toBe('repaired');
    expect(r.data).toEqual({ option: 'C', summary: 'Most ministers back C.', dissent: '', conditions: '' });
  });

  it('fails an option that is not on the table, or a missing summary', () => {
    expect(parseChairVerdict('{"option":"Z","summary":"Do Z.","dissent":"","conditions":""}', IDS).outcome).toBe('fail');
    expect(parseChairVerdict('{"option":"none","summary":"Wait.","dissent":"","conditions":""}', IDS).outcome).toBe('fail');
    expect(parseChairVerdict('{"option":"A","summary":"","dissent":"","conditions":""}', IDS).outcome).toBe('fail');
  });
});

describe('JSON Schema sent to the provider', () => {
  it('constrains the option to the letters on the table', () => {
    const m = jsonSchemaOf(ministerTurnSchema(IDS)) as { properties: Record<string, { enum?: string[] }>; required: string[]; additionalProperties: boolean; $schema?: string };
    expect(m.properties.option!.enum).toEqual(['A', 'B', 'C', 'none']);
    expect(m.properties.stance!.enum).toContain('oppose');
    expect(m.required.sort()).toEqual(['condition', 'option', 'say', 'speak', 'stance']);
    expect(m.additionalProperties).toBe(false);
    expect(m.$schema).toBeUndefined();
    const c = jsonSchemaOf(chairVerdictSchema(IDS)) as { properties: Record<string, { enum?: string[] }> };
    // The chair cannot answer "none".
    expect(c.properties.option!.enum).toEqual(['A', 'B', 'C']);
  });
});

describe('grounding check', () => {
  it('reads money shorthand', () => {
    expect(numbersIn('about $90k, or 1,250 a month')).toEqual([90000, 1250]);
    expect(numbersIn('412 m away')).toEqual([412]);
  });

  it('accepts figures that were shown, rounded, or summed from two shown figures', () => {
    const seen = 'Treasury $91,155. Costs $5,500 now and $340 a month. 298 residents.';
    expect(checkNumbers('A treasury over $90k covers the $5,500.', seen).ungrounded).toEqual([]);
    expect(checkNumbers('That is $5,840 in the first month.', seen).ungrounded).toEqual([]);
    expect(checkNumbers('It helps 4,750 residents.', seen).ungrounded).toEqual([4750]);
  });
});
