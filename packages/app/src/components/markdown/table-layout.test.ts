import { describe, expect, it } from "vitest";
import type { ASTNode } from "react-native-markdown-display";
import { isLastMarkdownTableChild } from "./table-layout";

function node(type: string, index: number, children: ASTNode[] = []): ASTNode {
  return { type, index, children } as ASTNode;
}

describe("isLastMarkdownTableChild", () => {
  it("identifies only the final body row", () => {
    const first = node("tr", 0);
    const last = node("tr", 1);
    const body = node("tbody", 0, [first, last]);

    expect(isLastMarkdownTableChild(first, [body], "tbody")).toBe(false);
    expect(isLastMarkdownTableChild(last, [body], "tbody")).toBe(true);
  });

  it("identifies only the final cell in a row", () => {
    const first = node("td", 0);
    const last = node("td", 1);
    const row = node("tr", 0, [first, last]);

    expect(isLastMarkdownTableChild(first, [row], "tr")).toBe(false);
    expect(isLastMarkdownTableChild(last, [row], "tr")).toBe(true);
  });

  it("does not treat a header row as the final body row", () => {
    const header = node("tr", 0);
    const head = node("thead", 0, [header]);

    expect(isLastMarkdownTableChild(header, [head], "tbody")).toBe(false);
  });
});
