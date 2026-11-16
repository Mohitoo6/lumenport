import { describe, expect, it } from 'vitest';
import { checkNumbers, checkStatement, devanagariShare, lettersIn, numbersIn } from '../eval/grade';

const SEEN = 'Market Street: 25.2 cars per 100 m; it jams at about 7. Option A costs $3,328 now; $7 an hour. Demolishes 11 workplaces (341 jobs). Residents within 200 m: 2019.';

describe('council output checks', () => {
  it('reads numbers in English and Devanagari digits', () => {
    expect(numbersIn('$3,328 now, 25.2 cars, ५०० घर')).toEqual([3328, 25.2, 500]);
  });

  it('accepts figures from the prompt, rounded figures and simple sums', () => {
    expect(checkNumbers('About 25 cars per 100 m and $3,328 to build.', SEEN).ungrounded).toEqual([]);
    expect(checkNumbers('That is 341 jobs lost.', SEEN).ungrounded).toEqual([]);
    // 3,328 + 2,019 is arithmetic on given figures, not invention.
    expect(checkNumbers('A total of 5,347.', SEEN).ungrounded).toEqual([]);
  });

  it('flags invented figures', () => {
    const r = checkNumbers('This will cut journey times by 64% and save $48,000 a year.', SEEN);
    expect(r.ungrounded).toEqual([64, 48000]);
  });

  it('finds option letters without mistaking the article "A"', () => {
    expect(lettersIn('A wider road is not the answer; I back option B.', ['A', 'B', 'C'])).toEqual(['B']);
    expect(lettersIn('Between B and C, I prefer C.', ['A', 'B', 'C'])).toEqual(['B', 'C']);
    expect(lettersIn('मैं विकल्प C का समर्थन करता हूँ।', ['A', 'B', 'C'])).toEqual(['C']);
  });

  it('checks the option field against the text and the language', () => {
    const ok = checkStatement({ option: 'B', stance: 'oppose', text: 'Option A demolishes 11 workplaces. I back B.' }, SEEN, ['A', 'B'], 'en');
    expect(ok.namesItsChoice && ok.validOption && ok.languageOk).toBe(true);
    const mismatch = checkStatement({ option: 'A', stance: 'oppose', text: 'I back option B.' }, SEEN, ['A', 'B'], 'en');
    expect(mismatch.namesItsChoice).toBe(false);
    expect(devanagariShare('मेयर साहब, विकल्प B सबसे अच्छा है।')).toBeGreaterThan(0.8);
    expect(checkStatement({ option: 'Z', stance: 'support', text: 'Fine.' }, SEEN, ['A'], 'en').validOption).toBe(false);
  });
});
