/**
 * Deterministic checks on council output: no model involved, so they cannot be fooled by
 * fluent text. Each check compares what a minister said with exactly what that minister
 * was shown (the prompt), or with the options the game generated.
 */

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

function asciiDigits(s: string): string {
  return s.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
}

/** Every number written in a text, as values (commas, $ and % removed). */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of asciiDigits(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const v = Number(m[0].replace(/,+$/, '').replace(/,/g, ''));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/** Small counts (lanes, rounds, "2 points") are not worth checking. */
const TRIVIAL = 12;

export interface NumberCheck {
  checked: number;
  ungrounded: number[];
}

/**
 * Numbers in `said` that do not appear in `seen` (allowing rounding of about 3%, and sums
 * or differences of two figures the speaker was given, for values above 100).
 */
export function checkNumbers(said: string, seen: string): NumberCheck {
  const pool = [...new Set(numbersIn(seen))];
  const near = (v: number, p: number): boolean => Math.abs(v - p) <= Math.max(0.5, Math.abs(p) * 0.03);
  const ungrounded: number[] = [];
  let checked = 0;
  for (const v of numbersIn(said)) {
    if (v <= TRIVIAL || (v >= 1900 && v <= 2100 && Number.isInteger(v))) continue;
    checked++;
    if (pool.some((p) => near(v, p))) continue;
    let derived = false;
    if (v > 100) {
      outer: for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          const a = pool[i]!;
          const b = pool[j]!;
          if (near(v, a + b) || near(v, Math.abs(a - b))) {
            derived = true;
            break outer;
          }
        }
      }
    }
    if (!derived) ungrounded.push(v);
  }
  return { checked, ungrounded };
}

/** Option letters a text refers to ("option B", "विकल्प B", or a bare capital B). */
export function lettersIn(text: string, valid: readonly string[]): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?:option|options|विकल्प)\s+([A-E])\b/giu)) found.add(m[1]!.toUpperCase());
  // A bare capital counts only where it cannot be the article "A": before punctuation or
  // the end, or in "A or B" / "B and C" pairs.
  for (const m of text.matchAll(/(?<![A-Za-z])([A-E])(?=\s*(?:[.,;:)!?।]|$))/gu)) found.add(m[1]!);
  for (const m of text.matchAll(/\b([A-E])\s+(?:or|and|over|than|या|और)\s+([A-E])\b/gu)) {
    found.add(m[1]!);
    found.add(m[2]!);
  }
  return [...found].filter((l) => valid.includes(l)).sort();
}

/** Share of letters that are Devanagari, among all letters. */
export function devanagariShare(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  const dev = letters.filter((c) => /[ऀ-ॿ]/.test(c)).length;
  return dev / letters.length;
}

export function sentences(text: string): number {
  return text
    .split(/(?<=[.!?।])\s+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 2).length;
}

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
