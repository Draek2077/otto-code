import { describe, expect, test } from "vitest";
import {
  buildRefactorPrompt,
  isRefactorInstructionValid,
  type RefactorScope,
} from "./refactor-prompt";

const rangeScope: RefactorScope = {
  path: "src/widget.ts",
  lineStart: 10,
  lineEnd: 14,
  selectedCode: "function render() {\n  return null;\n}",
};

describe("buildRefactorPrompt", () => {
  test("includes the path, line range, instruction, selection, and scope guard", () => {
    const prompt = buildRefactorPrompt({
      scope: rangeScope,
      instruction: "Extract this into a helper",
    });
    expect(prompt).toContain("`src/widget.ts`");
    expect(prompt).toContain("lines 10–14");
    expect(prompt).toContain("Instruction: Extract this into a helper");
    expect(prompt).toContain("function render()");
    expect(prompt).toContain("Do not add, remove, or upgrade dependencies.");
    expect(prompt).toContain("Change only what the instruction asks for");
  });

  test("describes a single-line scope without a range dash", () => {
    const prompt = buildRefactorPrompt({
      scope: { ...rangeScope, lineStart: 7, lineEnd: 7 },
      instruction: "Rename this",
    });
    expect(prompt).toContain("line 7.");
    expect(prompt).not.toContain("lines 7");
  });

  test("describes a whole-file refactor when there is no range", () => {
    const prompt = buildRefactorPrompt({
      scope: { path: "src/app.ts", lineStart: null, lineEnd: null, selectedCode: null },
      instruction: "Convert to async/await",
    });
    expect(prompt).toContain("the whole file `src/app.ts`");
    expect(prompt).not.toContain("Selected code:");
  });

  test("uses a longer fence when the selection contains backticks", () => {
    const prompt = buildRefactorPrompt({
      scope: { ...rangeScope, selectedCode: "const t = ```md```;" },
      instruction: "Fix",
    });
    expect(prompt).toContain("````");
  });

  test("throws on an empty instruction", () => {
    expect(() => buildRefactorPrompt({ scope: rangeScope, instruction: "   " })).toThrow();
  });

  test("isRefactorInstructionValid rejects blank instructions", () => {
    expect(isRefactorInstructionValid("")).toBe(false);
    expect(isRefactorInstructionValid("  ")).toBe(false);
    expect(isRefactorInstructionValid("do it")).toBe(true);
  });
});
