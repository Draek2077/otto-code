import { describe, expect, it } from "vitest";

import { cardinalWords, normalizeSpokenForms, ordinalWords, yearWords } from "./spoken-forms.js";

describe("cardinalWords", () => {
  it("spells out the shapes a number can take", () => {
    expect(cardinalWords(0)).toBe("zero");
    expect(cardinalWords(7)).toBe("seven");
    expect(cardinalWords(13)).toBe("thirteen");
    expect(cardinalWords(40)).toBe("forty");
    expect(cardinalWords(42)).toBe("forty-two");
    expect(cardinalWords(100)).toBe("one hundred");
    expect(cardinalWords(365)).toBe("three hundred sixty-five");
    expect(cardinalWords(1200)).toBe("one thousand two hundred");
    expect(cardinalWords(1_000_000)).toBe("one million");
    expect(cardinalWords(2_500_000)).toBe("two million five hundred thousand");
  });

  it("reads a decimal digit by digit after the point", () => {
    expect(cardinalWords(3.14)).toBe("three point one four");
    expect(cardinalWords(0.5)).toBe("zero point five");
  });

  it("handles negatives", () => {
    expect(cardinalWords(-12)).toBe("negative twelve");
  });
});

describe("ordinalWords", () => {
  it("inflects only the final word", () => {
    expect(ordinalWords(1)).toBe("first");
    expect(ordinalWords(3)).toBe("third");
    expect(ordinalWords(5)).toBe("fifth");
    expect(ordinalWords(12)).toBe("twelfth");
    expect(ordinalWords(20)).toBe("twentieth");
    expect(ordinalWords(25)).toBe("twenty-fifth");
    expect(ordinalWords(31)).toBe("thirty-first");
  });
});

describe("yearWords", () => {
  it("reads a year the way a year is read", () => {
    expect(yearWords(2026)).toBe("twenty twenty-six");
    expect(yearWords(1999)).toBe("nineteen ninety-nine");
    expect(yearWords(1905)).toBe("nineteen oh five");
    expect(yearWords(1900)).toBe("nineteen hundred");
    expect(yearWords(2000)).toBe("two thousand");
    expect(yearWords(2005)).toBe("two thousand five");
  });
});

describe("normalizeSpokenForms", () => {
  it("speaks an ISO date as words", () => {
    expect(normalizeSpokenForms("shipped 2026-07-25 on time")).toBe(
      "shipped July twenty-fifth, twenty twenty-six on time",
    );
  });

  it("speaks a slashed date as words", () => {
    expect(normalizeSpokenForms("due 07/04/2026")).toBe("due July fourth, twenty twenty-six");
  });

  it("turns a written-out date's day into an ordinal", () => {
    expect(normalizeSpokenForms("on July 25, 2026")).toBe(
      "on July twenty-fifth, twenty twenty-six",
    );
    expect(normalizeSpokenForms("on Jul 4 2026")).toBe("on July fourth, twenty twenty-six");
  });

  it("handles a month and day with no year", () => {
    expect(normalizeSpokenForms("due March 3rd")).toBe("due March third");
  });

  it("rejects an impossible date rather than mangling it", () => {
    expect(normalizeSpokenForms("build 2026-19-45 failed")).toBe("build 2026-19-45 failed");
  });

  it("speaks a clock time", () => {
    expect(normalizeSpokenForms("at 3:30")).toBe("at three thirty");
    expect(normalizeSpokenForms("at 3:00")).toBe("at three o'clock");
    expect(normalizeSpokenForms("at 3:05")).toBe("at three oh five");
  });

  it("speaks money with the symbol after the amount", () => {
    expect(normalizeSpokenForms("costs $5")).toBe("costs five dollars");
    expect(normalizeSpokenForms("costs $1")).toBe("costs one dollar");
    expect(normalizeSpokenForms("costs $1,200.50")).toBe(
      "costs one thousand two hundred dollars and fifty cents",
    );
    expect(normalizeSpokenForms("costs £10")).toBe("costs ten pounds");
    expect(normalizeSpokenForms("costs €20")).toBe("costs twenty euros");
  });

  it("speaks a percentage", () => {
    expect(normalizeSpokenForms("up 50%")).toBe("up fifty percent");
    expect(normalizeSpokenForms("up 12.5%")).toBe("up twelve point five percent");
  });

  it("speaks measurements, singular and plural", () => {
    expect(normalizeSpokenForms("weighs 5 kg")).toBe("weighs five kilograms");
    expect(normalizeSpokenForms("weighs 1 kg")).toBe("weighs one kilogram");
    expect(normalizeSpokenForms("ran 10km today")).toBe("ran ten kilometers today");
    expect(normalizeSpokenForms("uses 512 MB")).toBe("uses five hundred twelve megabytes");
    expect(normalizeSpokenForms("took 250 ms")).toBe("took two hundred fifty milliseconds");
  });

  it("says a measured range's unit once, after both numbers", () => {
    expect(normalizeSpokenForms("between 2-4 kg")).toBe("between two to four kilograms");
  });

  it("speaks a bare number range but leaves the digits to the engine", () => {
    expect(normalizeSpokenForms("2–4 seconds")).toBe("2 to 4 seconds");
    expect(normalizeSpokenForms("10-20 minutes")).toBe("10 to 20 minutes");
  });

  it("speaks a standalone written ordinal", () => {
    expect(normalizeSpokenForms("the 1st run")).toBe("the first run");
    expect(normalizeSpokenForms("the 22nd attempt")).toBe("the twenty-second attempt");
  });

  it("leaves hyphenated words, phone numbers and versions alone", () => {
    expect(normalizeSpokenForms("the sword-smith")).toBe("the sword-smith");
    expect(normalizeSpokenForms("a well-lit forge")).toBe("a well-lit forge");
    expect(normalizeSpokenForms("call 555-1234")).toBe("call 555-1234");
    expect(normalizeSpokenForms("version 1-2-3")).toBe("version 1-2-3");
  });

  it("leaves a bare number to the engine", () => {
    expect(normalizeSpokenForms("port 6868 is busy")).toBe("port 6868 is busy");
  });
});
