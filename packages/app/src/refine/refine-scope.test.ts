import { describe, expect, it } from "vitest";
import { isRefinableDocument } from "./refine-scope";

describe("isRefinableDocument", () => {
  it("accepts prose and instruction documents", () => {
    for (const path of [
      "CLAUDE.md",
      "docs/design.markdown",
      "notes.txt",
      "README.rst",
      "book/chapter.adoc",
      "packages/app/MEMORY.md",
    ]) {
      expect(isRefinableDocument(path)).toBe(true);
    }
  });

  // The whole reason this module exists: Refine has no symbol awareness, so a
  // plausible-looking rewrite of source is a silent breakage nobody spots in a
  // long diff. Code belongs to the LSP-backed tools.
  it("refuses source files of every language", () => {
    for (const path of [
      "src/index.ts",
      "src/App.tsx",
      "main.py",
      "Program.cs",
      "lib.rs",
      "app.go",
      "styles.css",
      "config.json",
      "schema.sql",
      "build.gradle",
      "Dockerfile.ts",
    ]) {
      expect(isRefinableDocument(path)).toBe(false);
    }
  });

  it("accepts extensionless prose by convention but not dotfiles", () => {
    expect(isRefinableDocument("LICENSE")).toBe(true);
    expect(isRefinableDocument("docs/AUTHORS")).toBe(true);
    expect(isRefinableDocument(".gitignore")).toBe(false);
    expect(isRefinableDocument("packages/app/.npmrc")).toBe(false);
  });

  it("ignores case and path separator style", () => {
    expect(isRefinableDocument("Docs\\Design.MD")).toBe(true);
    expect(isRefinableDocument("SRC\\Index.TS")).toBe(false);
  });
});
