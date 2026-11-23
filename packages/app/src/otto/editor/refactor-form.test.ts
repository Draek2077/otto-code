import { expect, it } from "vitest";
import { EditorRefactorForm } from "./refactor-form";
it("opens only an explicitly confirmed request draft, preserves failed input, and admits it once", () => {
  const form = new EditorRefactorForm({
    path: "file.ts",
    lineStart: 2,
    lineEnd: 3,
    selectedCode: "return value;",
  });
  const texts: string[] = [];
  expect(form.submit((text) => texts.push(text))).toBe(false);
  form.edit("Extract helper");
  expect(
    form.submit(() => {
      throw new Error("Draft unavailable");
    }),
  ).toBe(false);
  expect(form.getSnapshot()).toEqual({ instruction: "Extract helper", error: "Draft unavailable" });
  expect(form.submit((text) => texts.push(text))).toBe(true);
  expect(form.submit((text) => texts.push(text))).toBe(false);
  expect(texts).toHaveLength(1);
  expect(texts[0]).toContain("Scope rules (follow strictly):");
  expect(texts[0]).toContain("Extract helper");
});
