import { isExplicitPeriod, type ExplicitPeriod } from '@intellifin/domain';

/**
 * The testing period a person NAMED in their own words (UI cleanup 2026-09-22, UX-09).
 *
 * The owner asked the scope assistant for "employees terminated during August 2026" and
 * was told to save a period first. A period is part of the answer to "what should this
 * test cover", so the scope step now reads the dates out of the auditor's OWN request and
 * shows them beside the proposed scope as one proposal, to confirm or refuse together.
 *
 * The dates come from the person's words and never from the model's output: a model
 * cannot move the period, only the auditor's own sentence can, and acceptance is still
 * the auditor's explicit act through the existing Period-and-scope writer.
 *
 * Deliberately narrow. It recognises a month (`August 2026`, `Aug 2026`), a day range in
 * one month (`1–31 August 2026`), a range of two dates (`1 August 2026 to 15 September
 * 2026`, `2026-08-01 to 2026-08-31`), a month range (`July to September 2026`) and one
 * date alone. Anything it cannot read gives `null`, and so does a request naming two
 * DIFFERENT periods: choosing between them would be a guess, and the auditor then sets
 * the dates themselves exactly as before.
 */

const MONTHS: readonly (readonly string[])[] = [
  ['january', 'jan'], ['february', 'feb'], ['march', 'mar'], ['april', 'apr'], ['may'], ['june', 'jun'],
  ['july', 'jul'], ['august', 'aug'], ['september', 'sept', 'sep'], ['october', 'oct'], ['november', 'nov'], ['december', 'dec'],
];
const MONTH = MONTHS.flat().join('|');
const DASH = '(?:\\s*(?:–|—|-|to|until|through|till)\\s*)';

function monthIndex(word: string): number {
  const lower = word.toLowerCase();
  return MONTHS.findIndex((names) => names.includes(lower));
}

function two(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return `${year}-${two(month + 1)}-${two(day)}`;
}

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function period(from: string | null, to: string | null): ExplicitPeriod | null {
  if (from === null || to === null) return null;
  const candidate = { from, to };
  return isExplicitPeriod(candidate) ? candidate : null;
}

interface Reader {
  readonly pattern: RegExp;
  readonly read: (match: RegExpExecArray) => ExplicitPeriod | null;
}

/** Most specific first: a longer form consumes the shorter one inside it. */
const READERS: readonly Reader[] = [
  {
    pattern: /\b(\d{4})-(\d{2})-(\d{2})\b(?:\s*(?:–|—|-|to|until|through|till|and)\s*)\b(\d{4})-(\d{2})-(\d{2})\b/giu,
    read: (m) => period(isoDate(Number(m[1]), Number(m[2]) - 1, Number(m[3])), isoDate(Number(m[4]), Number(m[5]) - 1, Number(m[6]))),
  },
  {
    pattern: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})\\.?(?:\\s+(\\d{4}))?${DASH}(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})\\.?\\s+(\\d{4})\\b`, 'giu'),
    read: (m) => {
      const endYear = Number(m[6]);
      const startYear = m[3] === undefined ? endYear : Number(m[3]);
      return period(isoDate(startYear, monthIndex(m[2]!), Number(m[1])), isoDate(endYear, monthIndex(m[5]!), Number(m[4])));
    },
  },
  {
    pattern: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?${DASH}(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})\\.?\\s+(\\d{4})\\b`, 'giu'),
    read: (m) => {
      const year = Number(m[4]), month = monthIndex(m[3]!);
      return period(isoDate(year, month, Number(m[1])), isoDate(year, month, Number(m[2])));
    },
  },
  {
    pattern: new RegExp(`\\b(${MONTH})\\.?(?:\\s+(\\d{4}))?${DASH}(${MONTH})\\.?\\s+(\\d{4})\\b`, 'giu'),
    read: (m) => {
      const endYear = Number(m[4]);
      const startYear = m[2] === undefined ? endYear : Number(m[2]);
      const endMonth = monthIndex(m[3]!);
      return period(isoDate(startYear, monthIndex(m[1]!), 1), isoDate(endYear, endMonth, lastDay(endYear, endMonth)));
    },
  },
  {
    pattern: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})\\.?\\s+(\\d{4})\\b`, 'giu'),
    read: (m) => {
      const day = isoDate(Number(m[3]), monthIndex(m[2]!), Number(m[1]));
      return period(day, day);
    },
  },
  {
    pattern: new RegExp(`\\b(${MONTH})\\.?\\s+(\\d{4})\\b`, 'giu'),
    read: (m) => {
      const year = Number(m[2]), month = monthIndex(m[1]!);
      return period(isoDate(year, month, 1), isoDate(year, month, lastDay(year, month)));
    },
  },
  {
    pattern: /\b(\d{4})-(\d{2})-(\d{2})\b/giu,
    read: (m) => {
      const day = isoDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return period(day, day);
    },
  },
];

/** The one period `text` names, or `null` when it names none, several or an impossible one. */
export function periodNamedIn(text: string): ExplicitPeriod | null {
  if (typeof text !== 'string' || text.trim() === '') return null;
  let remaining = text;
  const found = new Map<string, ExplicitPeriod>();
  for (const reader of READERS) {
    remaining = remaining.replace(reader.pattern, (...args: unknown[]) => {
      const match = args.slice(0, -2) as unknown as RegExpExecArray;
      const named = reader.read(match);
      // An impossible date ("31 February 2026") is a date nobody can confirm; stop.
      found.set(named === null ? 'invalid' : `${named.from}/${named.to}`, named ?? { from: '', to: '' });
      return ' ';
    });
  }
  if (found.size !== 1 || found.has('invalid')) return null;
  return [...found.values()][0]!;
}
