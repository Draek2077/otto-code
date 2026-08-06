import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import { recoverMisnestedMarkdownFence } from "./fence-recovery";

function fences(source: string) {
  return new MarkdownIt().parse(source, {}).filter((token) => token.type === "fence");
}

describe("recoverMisnestedMarkdownFence", () => {
  it("keeps one malformed markdown wrapper as a single literal fence", () => {
    const malformed = [
      "```markdown",
      "# Title",
      "",
      "```",
      "inner code fence",
      "```",
      "",
      "more outer text with **literal markdown** → unchanged",
      "```",
    ].join("\n");

    const recovered = recoverMisnestedMarkdownFence(malformed);

    expect(recovered).toMatch(/^````markdown/m);
    expect(recovered).toMatch(/````$/m);
    expect(fences(recovered)).toHaveLength(1);
    expect(fences(recovered)[0]?.content).toContain("**literal markdown** → unchanged");
  });

  it("leaves an ordinary markdown fence alone", () => {
    const source = "```markdown\n# Title\n```";
    expect(recoverMisnestedMarkdownFence(source)).toBe(source);
  });

  it("leaves a correctly sized outer fence alone", () => {
    const source = "````markdown\n```\ninner\n```\n````";
    expect(recoverMisnestedMarkdownFence(source)).toBe(source);
  });

  it("leaves non-markdown fences alone", () => {
    const source = "```text\n```\ninner\n```\n```";
    expect(recoverMisnestedMarkdownFence(source)).toBe(source);
  });
});
