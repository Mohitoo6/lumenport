import { describe, expect, it } from 'vitest';
import { CHEAT_CODES, cheatAmount, codeHash } from '../../src/game/cheats';
import { creditRating } from '../../src/sim/economy/budget';

describe("the bank's credit rating", () => {
  const loan = (payment: number) => ({ tier: 0, payment, hoursLeft: 10 });
  it('grades a city by its hourly balance and how much of its income goes on repayments', () => {
    expect(creditRating({ population: 0, income: 0, net: 0, loans: [] }).grade).toBe('-');
    expect(creditRating({ population: 900, income: 2000, net: 600, loans: [] }).grade).toBe('A');
    expect(creditRating({ population: 900, income: 2000, net: 600, loans: [loan(300)] }).grade).toBe('B');
    expect(creditRating({ population: 900, income: 2000, net: 600, loans: [loan(600)] })).toMatchObject({ grade: 'C', share: 0.3 });
    expect(creditRating({ population: 900, income: 2000, net: -50, loans: [] }).grade).toBe('D');
  });
});

describe('the developer test codes', () => {
  it('match a code by its hash, whatever the case or spacing around it', async () => {
    const codes = [{ hash: (await codeHash('sample-code-7'))!, amount: 1234 }];
    expect(await cheatAmount('sample-code-7', codes)).toBe(1234);
    expect(await cheatAmount('  SAMPLE-code-7 ', codes)).toBe(1234);
  });

  it('ignore everything else, including near misses and ordinary questions', async () => {
    const codes = [{ hash: (await codeHash('sample-code-7'))!, amount: 1234 }];
    for (const q of ['sample-code-', 'sample-code-77', 'sample code-7', 'Why is my money going down?', '']) expect(await cheatAmount(q, codes)).toBe(0);
  });

  it('keep only hashes in the code: three amounts, no readable codes', () => {
    expect(CHEAT_CODES.map((c) => c.amount)).toEqual([50_000, 100_000, 150_000]);
    for (const c of CHEAT_CODES) expect(c.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
