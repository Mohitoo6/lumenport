/**
 * Deterministic checks on council output for the offline evaluation. The text checks live
 * in the game (`src/game/council/grounding.ts`), where the guardrail layer runs them on
 * every statement; this file adds the per-statement summary the report uses.
 */
import { checkNumbers, devanagariShare, lettersIn, sentences, type NumberCheck } from '../../src/game/council/grounding';

export { checkNumbers, devanagariShare, lettersIn, numbersIn, sentences, type NumberCheck } from '../../src/game/council/grounding';

export interface StatementCheck {
  validOption: boolean;
  /** The option field names a letter the text itself mentions (or the text names none). */
  namesItsChoice: boolean;
  numbers: NumberCheck;
  sentences: number;
  lengthOk: boolean;
  languageOk: boolean;
}

export function checkStatement(
  s: { option: string; text: string; stance: string },
  seen: string,
  valid: readonly string[],
  lang: 'en' | 'hi',
): StatementCheck {
  const letters = lettersIn(s.text, valid);
  const n = sentences(s.text);
  return {
    validOption: s.option === 'none' || valid.includes(s.option),
    namesItsChoice: s.option === 'none' || letters.length === 0 || letters.includes(s.option),
    numbers: checkNumbers(s.text, seen),
    sentences: n,
    lengthOk: n >= 1 && n <= 5,
    languageOk: lang === 'hi' ? devanagariShare(s.text) >= 0.5 : devanagariShare(s.text) < 0.05,
  };
}
