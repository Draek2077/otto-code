// Written notation → the words a voice should say.
//
// "2026-07-25", "$1,200.50" and "5 km" are *notation*: the glyphs are a
// shorthand for words, and a TTS model has to guess which words. We do not let
// it guess. sherpa-onnx can run rule-based text normalization (`ruleFsts` on
// the OfflineTts config) but we do not configure any, so the only thing
// standing between "2026-07-25" and the speaker is espeak-ng's fallback
// guessing — which reads it as arithmetic. Everything this module rewrites is
// therefore turned into plain words before synthesis, and the result no longer
// depends on what the engine would have done.
//
// The scope rule: a number is spelled out only when it is part of a construct
// being rewritten anyway (a date, a time, a price, a measurement), because the
// words around it have to agree with it. A bare integer is LEFT ALONE — every
// engine reads "42" correctly, and spelling out every loose number would also
// wreck ports, versions and identifiers.
//
// This is a pronunciation pass, and it is deliberately separate from
// segmentation: `tts-segmenter.ts` promises never to consume a punctuation
// mark while *cutting* text, which says nothing about how a range or a price
// is *pronounced*.

const SMALL_CARDINALS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];

const TENS_CARDINALS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

const SCALES: readonly (readonly [number, string])[] = [
  [1_000_000_000_000, "trillion"],
  [1_000_000_000, "billion"],
  [1_000_000, "million"],
  [1_000, "thousand"],
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_NAME_PATTERN =
  "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|" +
  "Aug(?:ust)?|Sep(?:t)?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";

function monthIndexFromName(name: string): number | null {
  const prefix = name.slice(0, 3).toLowerCase();
  const index = MONTHS.findIndex((month) => month.slice(0, 3).toLowerCase() === prefix);
  return index === -1 ? null : index;
}

function integerWords(value: number): string {
  if (value < 20) {
    return SMALL_CARDINALS[value];
  }
  if (value < 100) {
    const tens = TENS_CARDINALS[Math.floor(value / 10)];
    const ones = value % 10;
    return ones ? `${tens}-${SMALL_CARDINALS[ones]}` : tens;
  }
  if (value < 1000) {
    const hundreds = `${SMALL_CARDINALS[Math.floor(value / 100)]} hundred`;
    const rest = value % 100;
    return rest ? `${hundreds} ${integerWords(rest)}` : hundreds;
  }
  for (const [scale, name] of SCALES) {
    if (value >= scale) {
      const count = `${integerWords(Math.floor(value / scale))} ${name}`;
      const rest = value % scale;
      return rest ? `${count} ${integerWords(rest)}` : count;
    }
  }
  return String(value);
}

/** Spell a number out. Decimals are read digit by digit after the point, the
 * way "three point one four" is said rather than "three point fourteen". */
export function cardinalWords(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  if (value < 0) {
    return `negative ${cardinalWords(-value)}`;
  }
  if (Number.isInteger(value)) {
    return integerWords(value);
  }
  const [whole, fraction = ""] = String(value).split(".");
  const digits = fraction
    .split("")
    .map((digit) => SMALL_CARDINALS[Number(digit)])
    .join(" ");
  return `${integerWords(Number(whole))} point ${digits}`;
}

const IRREGULAR_ORDINALS: Record<string, string> = {
  one: "first",
  two: "second",
  three: "third",
  five: "fifth",
  eight: "eighth",
  nine: "ninth",
  twelve: "twelfth",
};

/** "25" → "twenty-fifth". Only the final word inflects: "twenty-five" becomes
 * "twenty-fifth", not "twentieth-fifth". */
export function ordinalWords(value: number): string {
  const words = cardinalWords(value);
  const match = /[\s-]?([a-z]+)$/.exec(words);
  if (!match) {
    return words;
  }
  const last = match[1];
  const head = words.slice(0, words.length - last.length);
  if (IRREGULAR_ORDINALS[last]) {
    return `${head}${IRREGULAR_ORDINALS[last]}`;
  }
  if (last.endsWith("y")) {
    return `${head}${last.slice(0, -1)}ieth`;
  }
  return `${head}${last}th`;
}

/** Years are read as their own thing: "twenty twenty-six", "nineteen oh five",
 * "two thousand" — never "two thousand and twenty-six". */
export function yearWords(year: number): string {
  if (year < 1000 || year > 9999 || year % 1000 === 0) {
    return integerWords(year);
  }
  if (year % 1000 < 10) {
    return integerWords(year);
  }
  const high = Math.floor(year / 100);
  const low = year % 100;
  if (low === 0) {
    return `${integerWords(high)} hundred`;
  }
  if (low < 10) {
    return `${integerWords(high)} oh ${SMALL_CARDINALS[low]}`;
  }
  return `${integerWords(high)} ${integerWords(low)}`;
}

function parseNumeric(text: string): number {
  return Number(text.replace(/,/g, ""));
}

function dateWords(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return `${MONTHS[month - 1]} ${ordinalWords(day)}, ${yearWords(year)}`;
}

interface UnitNames {
  one: string;
  many: string;
}

// Abbreviations that are unambiguously a unit when they follow a number.
// Deliberately excluded: bare "m", "g", "s" and "in", which collide with
// ordinary words often enough ("5 in the morning") that rewriting them would
// do more damage than leaving the engine to read the abbreviation.
const UNITS: Record<string, UnitNames> = {
  kg: { one: "kilogram", many: "kilograms" },
  mg: { one: "milligram", many: "milligrams" },
  km: { one: "kilometer", many: "kilometers" },
  cm: { one: "centimeter", many: "centimeters" },
  mm: { one: "millimeter", many: "millimeters" },
  ml: { one: "milliliter", many: "milliliters" },
  lb: { one: "pound", many: "pounds" },
  lbs: { one: "pound", many: "pounds" },
  oz: { one: "ounce", many: "ounces" },
  ft: { one: "foot", many: "feet" },
  mi: { one: "mile", many: "miles" },
  kb: { one: "kilobyte", many: "kilobytes" },
  mb: { one: "megabyte", many: "megabytes" },
  gb: { one: "gigabyte", many: "gigabytes" },
  tb: { one: "terabyte", many: "terabytes" },
  ms: { one: "millisecond", many: "milliseconds" },
  hz: { one: "hertz", many: "hertz" },
  khz: { one: "kilohertz", many: "kilohertz" },
  mhz: { one: "megahertz", many: "megahertz" },
  ghz: { one: "gigahertz", many: "gigahertz" },
  "°c": { one: "degree Celsius", many: "degrees Celsius" },
  "°f": { one: "degree Fahrenheit", many: "degrees Fahrenheit" },
};

// Longest first, so "khz" is never matched as "hz" with a stray "k" in front.
const UNIT_PATTERN = Object.keys(UNITS)
  .sort((a, b) => b.length - a.length)
  .join("|");

interface CurrencyNames {
  one: string;
  many: string;
  subOne: string;
  subMany: string;
}

const CURRENCIES: Record<string, CurrencyNames> = {
  $: { one: "dollar", many: "dollars", subOne: "cent", subMany: "cents" },
  "£": { one: "pound", many: "pounds", subOne: "penny", subMany: "pence" },
  "€": { one: "euro", many: "euros", subOne: "cent", subMany: "cents" },
  "¥": { one: "yen", many: "yen", subOne: "sen", subMany: "sen" },
};

function pluralize(value: number, names: UnitNames): string {
  return value === 1 ? names.one : names.many;
}

function unitPhrase(amountText: string, unitKey: string): string {
  const names = UNITS[unitKey.toLowerCase()];
  const amount = parseNumeric(amountText);
  if (!names || !Number.isFinite(amount)) {
    return `${amountText} ${unitKey}`;
  }
  return `${cardinalWords(amount)} ${pluralize(amount, names)}`;
}

/**
 * Rewrite written notation into spoken words. Order matters: constructs that
 * own their separators (dates own their hyphens and slashes, times own their
 * colon) are consumed first, so the later, looser rules never see them.
 */
export function normalizeSpokenForms(text: string): string {
  let out = text;

  // ISO date — the case that reads as arithmetic if left alone.
  out = out.replace(
    /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    (whole, y, m, d) => dateWords(Number(y), Number(m), Number(d)) ?? whole,
  );

  // Slashed date, month first.
  out = out.replace(
    /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,
    (whole, m, d, y) => dateWords(Number(y), Number(m), Number(d)) ?? whole,
  );

  // "July 25, 2026" / "Jul 25 2026" — the day becomes an ordinal, which is how
  // it is read even though it is written as a cardinal.
  out = out.replace(
    new RegExp(
      `\\b(${MONTH_NAME_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`,
      "gi",
    ),
    (whole, name: string, d: string, y: string) => {
      const month = monthIndexFromName(name);
      if (month === null) {
        return whole;
      }
      return dateWords(Number(y), month + 1, Number(d)) ?? whole;
    },
  );

  // "July 25" with no year.
  out = out.replace(
    new RegExp(`\\b(${MONTH_NAME_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "gi"),
    (whole, name: string, d: string) => {
      const month = monthIndexFromName(name);
      const day = Number(d);
      if (month === null || day < 1 || day > 31) {
        return whole;
      }
      return `${MONTHS[month]} ${ordinalWords(day)}`;
    },
  );

  // Clock time. "3:30" is "three thirty", "3:00" is "three o'clock", and a
  // single-digit minute takes the spoken "oh": "three oh five".
  out = out.replace(
    /\b(\d{1,2}):([0-5]\d)(?:\s*([ap])\.?m\.?)?\b/gi,
    (whole, h: string, m: string, meridiem: string | undefined) => {
      const hour = Number(h);
      const minute = Number(m);
      if (hour > 24) {
        return whole;
      }
      const suffix = meridiem ? ` ${meridiem.toLowerCase()} m` : "";
      if (minute === 0) {
        return `${cardinalWords(hour)} o'clock${suffix}`;
      }
      const minuteWords = minute < 10 ? `oh ${SMALL_CARDINALS[minute]}` : cardinalWords(minute);
      return `${cardinalWords(hour)} ${minuteWords}${suffix}`;
    },
  );

  // Money. The symbol precedes the number in writing and follows it in speech.
  out = out.replace(
    /([$£€¥])\s?(\d[\d,]*)(?:\.(\d{2}))?\b/g,
    (whole, symbol: string, amount: string, cents: string | undefined) => {
      const names = CURRENCIES[symbol];
      const value = parseNumeric(amount);
      if (!names || !Number.isFinite(value)) {
        return whole;
      }
      const major = `${cardinalWords(value)} ${value === 1 ? names.one : names.many}`;
      if (!cents || Number(cents) === 0) {
        return major;
      }
      const minor = Number(cents);
      return `${major} and ${cardinalWords(minor)} ${minor === 1 ? names.subOne : names.subMany}`;
    },
  );

  out = out.replace(/(\d[\d,]*(?:\.\d+)?)\s?%/g, (whole, amount: string) => {
    const value = parseNumeric(amount);
    return Number.isFinite(value) ? `${cardinalWords(value)} percent` : whole;
  });

  // A measured range keeps one unit at the end in writing ("2–4 kg") but says
  // the unit once, after both numbers.
  out = out.replace(
    new RegExp(
      `\\b(\\d[\\d,]*(?:\\.\\d+)?)\\s*[-–]\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s?(${UNIT_PATTERN})\\b`,
      "gi",
    ),
    (whole, low: string, high: string, unit: string) => {
      const lowValue = parseNumeric(low);
      if (!Number.isFinite(lowValue)) {
        return whole;
      }
      return `${cardinalWords(lowValue)} to ${unitPhrase(high, unit)}`;
    },
  );

  out = out.replace(
    new RegExp(`\\b(\\d[\\d,]*(?:\\.\\d+)?)\\s?(${UNIT_PATTERN})\\b`, "gi"),
    (_whole, amount: string, unit: string) => unitPhrase(amount, unit),
  );

  // A written ordinal ("1st") is already a word in disguise.
  out = out.replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, (whole, value: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? ordinalWords(parsed) : whole;
  });

  // A dash between bare numbers is a range: "2–4" is "2 to 4". The digits stay
  // digits — the engine reads those correctly, and this rule only has to fix
  // the separator. The hyphen form is guarded so dates, phone numbers and
  // version strings never match.
  out = out.replace(/(?<=\d)\s*–\s*(?=\d)/g, " to ");
  out = out.replace(/(?<![\d-])(\d{1,3})\s*-\s*(\d{1,3})(?![\d-])/g, "$1 to $2");

  return out;
}
