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

/**
 * The payloads below are verbatim from csharp-ls 0.16.0 against a real solution. It emits no
 * fences at all: the signature is a double-backtick code span, so a C# hover rendered as drab
 * prose with the outer ticks still showing, right next to TypeScript's highlighted block.
 */
describe("an unfenced signature, the shape csharp-ls emits", () => {
  it("treats a run that is wholly a code span as the signature", () => {
    expect(
      parseHoverMarkdown("`` int GroupMessageService.PatientCommunicationBatchSize ``"),
    ).toEqual<HoverSegment[]>([
      { kind: "code", language: "", text: "int GroupMessageService.PatientCommunicationBatchSize" },
    ]);
  });

  it("splits the signature from the documentation that follows it", () => {
    const markdown =
      "`` ConversationEntryControllerService ``\n\nThis service implements controller specific logic.";

    expect(parseHoverMarkdown(markdown)).toEqual<HoverSegment[]>([
      { kind: "code", language: "", text: "ConversationEntryControllerService" },
      { kind: "prose", text: "This service implements controller specific logic." },
    ]);
  });

  it("handles a single-backtick span too, which other servers use", () => {
    expect(parseHoverMarkdown("`const spec: any`")).toEqual<HoverSegment[]>([
      { kind: "code", language: "", text: "const spec: any" },
    ]);
  });

  it("leaves prose that merely contains a code span as prose", () => {
    const markdown = "Returns the `id` of the record.";

    expect(parseHoverMarkdown(markdown)).toEqual<HoverSegment[]>([
      { kind: "prose", text: markdown },
    ]);
  });
});

describe("plainProse and inline code delimiters", () => {
  it("strips a double-backtick span without leaving the outer ticks", () => {
    // The bug this pins: the old single-backtick strip turned "`` X ``" into "` X `", which is
    // the "strange quotes" a C# hover showed.
    expect(plainProse("`` GroupMessageService ``")).toBe("GroupMessageService");
  });

  it("still strips a single-backtick span", () => {
    expect(plainProse("the `id` field")).toBe("the id field");
  });
});
