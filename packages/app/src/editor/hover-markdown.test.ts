import { describe, expect, it } from "vitest";
import {
  filenameForHoverLanguage,
  parseHoverMarkdown,
  plainProse,
  type HoverSegment,
} from "./hover-markdown";

describe("parsing hover markdown", () => {
  it("recovers the signature from a fenced block, with its language", () => {
    // What typescript-language-server actually returns for a function.
    const markdown = "```typescript\nfunction fromFileUri(uri: string): string\n```";

    expect(parseHoverMarkdown(markdown)).toEqual<HoverSegment[]>([
      { kind: "code", language: "typescript", text: "function fromFileUri(uri: string): string" },
    ]);
  });

  it("separates the signature from the documentation that follows it", () => {
    const markdown = [
      "```typescript",
      "function greet(name: string): string",
      "```",
      "",
      "Greets someone by name.",
    ].join("\n");

    expect(parseHoverMarkdown(markdown)).toEqual<HoverSegment[]>([
      { kind: "code", language: "typescript", text: "function greet(name: string): string" },
      { kind: "prose", text: "Greets someone by name." },
    ]);
  });

  it("keeps several blocks in order", () => {
    const markdown = ["Intro.", "```ts", "const a = 1;", "```", "Outro."].join("\n");

    expect(parseHoverMarkdown(markdown).map((segment) => segment.kind)).toEqual([
      "prose",
      "code",
      "prose",
    ]);
  });

  it("treats an unterminated fence as running to the end", () => {
    // Servers do emit these; the signature is usually what is inside.
    const markdown = "```typescript\nfunction orphan(): void";

    expect(parseHoverMarkdown(markdown)).toEqual<HoverSegment[]>([
      { kind: "code", language: "typescript", text: "function orphan(): void" },
    ]);
  });

  it("drops whitespace-only runs rather than emitting empty sections", () => {
    const markdown = "\n\n```ts\nconst a = 1;\n```\n\n\n";

    expect(parseHoverMarkdown(markdown)).toHaveLength(1);
  });

  it("records an untagged fence as code with no language", () => {
    expect(parseHoverMarkdown("```\nplain\n```")).toEqual<HoverSegment[]>([
      { kind: "code", language: "", text: "plain" },
    ]);
  });

  it("preserves blank lines inside a code block", () => {
    const markdown = "```ts\nconst a = 1;\n\nconst b = 2;\n```";

    expect(parseHoverMarkdown(markdown)[0].text).toBe("const a = 1;\n\nconst b = 2;");
  });

  it("returns nothing for empty content", () => {
    expect(parseHoverMarkdown("")).toEqual([]);
    expect(parseHoverMarkdown("   \n  ")).toEqual([]);
  });
});

describe("prose cleanup", () => {
  it("strips the inline markers servers use", () => {
    expect(plainProse("**Bold** and _italic_ and `code`.")).toBe("Bold and italic and code.");
  });

  it("leaves an underscore inside an identifier alone", () => {
    expect(plainProse("Use snake_case_name here.")).toBe("Use snake_case_name here.");
  });
});

describe("language to parser filename", () => {
  it("maps the language names servers tag with", () => {
    expect(filenameForHoverLanguage("typescript")).toBe("hover.ts");
    expect(filenameForHoverLanguage("python")).toBe("hover.py");
    expect(filenameForHoverLanguage("csharp")).toBe("hover.cs");
  });

  it("is null for an unknown or absent tag, so the caller skips highlighting", () => {
    expect(filenameForHoverLanguage("")).toBeNull();
    expect(filenameForHoverLanguage("brainfuck")).toBeNull();
  });
});
