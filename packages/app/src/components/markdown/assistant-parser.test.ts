import { describe, expect, it } from "vitest";
import { createAssistantMarkdownParser } from "./assistant-parser";
import { MATH_BLOCK_TOKEN, MATH_INLINE_TOKEN } from "./math";

interface FlatToken {
  type: string;
  content: string;
}

function flatten(source: string): FlatToken[] {
  const parser = createAssistantMarkdownParser();
  const collect = (tokens: FlatToken[] & { children?: FlatToken[] }[]): FlatToken[] =>
    tokens.flatMap((token) => [
      token,
      ...collect((token as { children?: FlatToken[] }).children ?? []),
    ]);
  return collect(parser.parse(source, {}) as FlatToken[]);
}

describe("createAssistantMarkdownParser", () => {
  it("parses display math into its own token", () => {
    const tokens = flatten("$$\n\\int_{a}^{b} f(x) \\, dx = F(b) - F(a)\n$$");
    const math = tokens.find((token) => token.type === MATH_BLOCK_TOKEN);
    expect(math?.content).toBe("\\int_{a}^{b} f(x) \\, dx = F(b) - F(a)");
  });

  it("parses inline math inside a paragraph", () => {
    const tokens = flatten("the area $A = \\pi r^2$ grows");
    expect(tokens.find((token) => token.type === MATH_INLINE_TOKEN)?.content).toBe("A = \\pi r^2");
  });

  it("leaves currency alone", () => {
    const tokens = flatten("it cost $5 and $10");
    expect(tokens.some((token) => token.type === MATH_INLINE_TOKEN)).toBe(false);
  });

  it("keeps typographer on, unlike the user bubble's parser", () => {
    const tokens = flatten('She said "hello"');
    expect(tokens.some((token) => token.content.includes("“hello”"))).toBe(true);
  });

  it("accepts file:// links markdown-it would otherwise reject", () => {
    const parser = createAssistantMarkdownParser();
    expect(parser.validateLink("file:///tmp/out.png")).toBe(true);
    expect(parser.validateLink("javascript:alert(1)")).toBe(false);
  });
});
