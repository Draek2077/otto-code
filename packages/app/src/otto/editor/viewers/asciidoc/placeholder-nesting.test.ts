import { describe, expect, it } from "vitest";
import { asciiDocToMarkdown } from "./asciidoc-to-markdown";

const convert = (source: string) => asciiDocToMarkdown(source).body;

/** The converter's protect/restore sentinels, which must never reach output. */
const SENTINELS = new RegExp(`[${String.fromCharCode(0)}${String.fromCharCode(1)}]`);

// `convertInline` protects spans by swapping them for a sentinel pair and
// restores them at the end. Protected spans nest - a code span inside a link
// label, bold run or image alt is stored with another span's sentinel still
// inside it - and `String.replace` never re-scans its own replacement output,
// so a single restore pass left the inner sentinel in the rendered markdown as
// raw control characters.
describe("nested protected spans", () => {
  it("restores a code span inside a link label", () => {
    const result = convert("link:https://example.com[`run` this]");
    expect(result).not.toMatch(SENTINELS);
    expect(result).toBe("[`run` this](https://example.com)");
  });

  it("restores a code span inside a link label mid-paragraph", () => {
    const result = convert("See link:https://otto.dev/docs[the `--stage` flag] before you start.");
    expect(result).not.toMatch(SENTINELS);
    expect(result).toContain("`--stage`");
  });

  it("restores a code span inside a mailto label", () => {
    const result = convert("mailto:dev@example.com[mail `support` now]");
    expect(result).not.toMatch(SENTINELS);
    expect(result).toContain("`support`");
  });

  it("restores a code span inside bold text", () => {
    const result = convert("*`run` this*");
    expect(result).not.toMatch(SENTINELS);
    expect(result).toContain("`run`");
  });

  it("restores a code span inside image alt text", () => {
    const result = convert("image:diagram.png[`alt` text]");
    expect(result).not.toMatch(SENTINELS);
    expect(result).toContain("`alt`");
  });
});
