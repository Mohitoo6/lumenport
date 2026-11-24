import { describe, expect, it } from 'vitest';
import { cheatAmount } from '../../src/game/cheats';
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

describe("the developers' test codes", () => {
  it('grant 50,000, 100,000 or 150,000 for the right codes, whatever the case or spacing around them', async () => {
    expect(await cheatAmount('samplecode50')).toBe(50_000);
    expect(await cheatAmount('  GoldRush100 ')).toBe(100_000);
    expect(await cheatAmount('samplecode150')).toBe(150_000);
  });

  it('ignore everything else, including near misses and ordinary questions', async () => {
    for (const q of ['samplecode', 'samplecode500', 'gold rush50', 'Why is my money going down?', '', 'samplecode50!']) expect(await cheatAmount(q)).toBe(0);
  });
});
