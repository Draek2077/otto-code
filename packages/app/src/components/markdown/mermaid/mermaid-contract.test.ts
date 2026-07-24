import { describe, expect, it } from "vitest";
import { isMermaidFenceLanguage } from "./mermaid-contract";

describe("isMermaidFenceLanguage", () => {
  it("matches the mermaid fence tag and its short form", () => {
    expect(isMermaidFenceLanguage("mermaid")).toBe(true);
    expect(isMermaidFenceLanguage("Mermaid")).toBe(true);
    expect(isMermaidFenceLanguage("MMD")).toBe(true);
  });

  it("matches when the info string carries trailing attributes", () => {
    // ```mermaid {theme=dark} — common in docs tooling; still a diagram.
    expect(isMermaidFenceLanguage("mermaid {theme=dark}")).toBe(true);
    expect(isMermaidFenceLanguage("  mermaid  ")).toBe(true);
  });

  it("leaves every other fence to the code highlighter", () => {
    expect(isMermaidFenceLanguage("ts")).toBe(false);
    expect(isMermaidFenceLanguage("mermaidjs")).toBe(false);
    expect(isMermaidFenceLanguage("js mermaid")).toBe(false);
    expect(isMermaidFenceLanguage("")).toBe(false);
    expect(isMermaidFenceLanguage(null)).toBe(false);
    expect(isMermaidFenceLanguage(undefined)).toBe(false);
  });
});
