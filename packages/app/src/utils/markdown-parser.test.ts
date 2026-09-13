import { describe, expect, it } from "vitest";
import { createMarkdownParser } from "./markdown-parser";

// Literal sequences covered by current or historical typography substitutions.
// Sourced from markdown-it's replacements and smartquotes rules.
// `--flag` is deliberately absent: the en-dash rules need
// whitespace or a word character on both sides, so a CLI flag after a space is
// never touched and asserting on it would prove nothing.
const LITERAL_SEQUENCES = [
  "(c)",
  "(C)",
  "(r)",
  "(R)",
  "(tm)",
  "(TM)",
  "(p)",
  "(P)",
  "+-",
  "two dots .. here",
  "wait for it...",
  "what????",
  "stop!!!!",
  "hmm,, ok",
  "a -- b",
  "word--word",
  "a --- b",
  'run --name="my repo"',
  "it's fine",
];

describe("createMarkdownParser", () => {
  it("renders every typographer-rewritten sequence verbatim", () => {
    const parser = createMarkdownParser({ linkify: true });

    for (const source of LITERAL_SEQUENCES) {
      expect(parser.renderInline(source)).toBe(escapeHtml(source));
    }
  });

  it("would fail if typographer were switched back on", () => {
    // Guards the assertion above: proves the fixture actually exercises the
    // rules, so a future refactor can't quietly make the test vacuous.
    const typographer = createMarkdownParser({ linkify: true });
    typographer.set({ typographer: true });

    // These representative substitutions remain active in markdown-it 15;
    // historical (p)/(P) spellings above must stay verbatim regardless of version.
    for (const source of ["(c)", "wait for it...", 'run --name="my repo"']) {
      expect(typographer.renderInline(source)).not.toBe(escapeHtml(source));
    }
  });

  it("rejects file:// links", () => {
    const parser = createMarkdownParser({ linkify: true });

    expect(parser.render("[open](file:///tmp/a.ts)")).not.toContain("href");
  });

  it("rejects javascript: links", () => {
    const parser = createMarkdownParser({ linkify: true });

    expect(parser.render("[x](javascript:alert(1))")).not.toContain("href");
  });

  it("linkifies bare URLs only when asked", () => {
    expect(createMarkdownParser({ linkify: true }).render("see https://paseo.sh now")).toContain(
      'href="https://paseo.sh"',
    );
    expect(
      createMarkdownParser({ linkify: false }).render("see https://paseo.sh now"),
    ).not.toContain("href");
  });
});

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
}
