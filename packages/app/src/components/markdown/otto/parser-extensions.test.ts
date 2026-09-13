import { describe, expect, it } from "vitest";
import { createAssistantMarkdownParser as createBaseAssistantParser } from "@/utils/assistant-markdown-parser";
import { createMarkdownParser } from "@/utils/markdown-parser";
import {
  applyOttoAssistantMarkdownExtensions,
  applyOttoDocumentMarkdownExtensions,
} from "./parser-extensions";
import { TASK_STATE_ATTRIBUTE, TASK_LINE_ATTRIBUTE } from "../task-lists";
import { ALERT_ATTRIBUTE } from "../github-alerts";
const createAssistantMarkdownParser = () =>
  applyOttoAssistantMarkdownExtensions(createBaseAssistantParser());
import { MATH_BLOCK_TOKEN, MATH_INLINE_TOKEN } from "../math";

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

  it("preserves literal option labels and quoted shell arguments with the extensions enabled", () => {
    const tokens = flatten('(c) She said "hello" ... a -- b');
    expect(tokens.some((token) => token.content === '(c) She said "hello" ... a -- b')).toBe(true);
    expect(tokens.some((token) => token.content.includes("“hello”"))).toBe(false);
  });

  it("accepts file:// links markdown-it would otherwise reject", () => {
    const parser = createAssistantMarkdownParser();
    expect(parser.validateLink("file:///tmp/out.png")).toBe(true);
    expect(parser.validateLink("javascript:alert(1)")).toBe(false);
  });
});

it("keeps task states and source lines after parsing assistant prose", () => {
  const tasks = createAssistantMarkdownParser()
    .parse("- [x] done\n- [ ] next\n", {})
    .filter((token) => token.type === "list_item_open");
  expect(
    tasks.map((token) => [token.attrGet(TASK_STATE_ATTRIBUTE), token.attrGet(TASK_LINE_ATTRIBUTE)]),
  ).toEqual([
    ["checked", "1"],
    ["unchecked", "2"],
  ]);
});

it("preserves footnotes and only applies alert conversion to the document profile", () => {
  const assistant = createAssistantMarkdownParser();
  const document = applyOttoDocumentMarkdownExtensions(createMarkdownParser({ linkify: true }));
  const note = "Claim[^a].\n\n[^a]: Source.\n";
  expect(
    assistant
      .parse(note, {})
      .filter((token) => token.type === "inline")
      .map((token) => token.content),
  ).toEqual(["Claim¹.", "Source."]);
  const alert = "> [!WARNING]\n> Careful.";
  expect(
    assistant
      .parse(alert, {})
      .find((token) => token.type === "blockquote_open")
      ?.attrGet(ALERT_ATTRIBUTE),
  ).toBeNull();
  expect(
    document
      .parse(alert, {})
      .find((token) => token.type === "blockquote_open")
      ?.attrGet(ALERT_ATTRIBUTE),
  ).toBe("warning");
  expect(document.validateLink("file:///tmp/out.png")).toBe(false);
});
