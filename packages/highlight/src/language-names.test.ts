import { describe, expect, it } from "vitest";
import { getLanguageDisplayName } from "./language-names.js";

describe("getLanguageDisplayName", () => {
  it("names common extensions", () => {
    expect(getLanguageDisplayName("index.ts")).toBe("TypeScript");
    expect(getLanguageDisplayName("App.tsx")).toBe("TypeScript JSX");
    expect(getLanguageDisplayName("README.md")).toBe("Markdown");
    expect(getLanguageDisplayName("main.rs")).toBe("Rust");
  });

  it("reads the last extension of a multi-part name", () => {
    expect(getLanguageDisplayName("vite.config.ts")).toBe("TypeScript");
    expect(getLanguageDisplayName("bundle.min.css")).toBe("CSS");
  });

  it("resolves against the basename, not the directory", () => {
    expect(getLanguageDisplayName("src/py.utils/main.go")).toBe("Go");
    expect(getLanguageDisplayName("C:\\proj\\a.rs\\b.py")).toBe("Python");
  });

  it("treats a leading dot as part of the name, not an extension separator", () => {
    expect(getLanguageDisplayName(".gitignore")).toBe("Git Ignore");
    expect(getLanguageDisplayName(".editorconfig")).toBe("EditorConfig");
  });

  it("names extensionless files by their whole name", () => {
    expect(getLanguageDisplayName("Dockerfile")).toBe("Dockerfile");
    expect(getLanguageDisplayName("makefile")).toBe("Makefile");
  });

  it("is case-insensitive", () => {
    expect(getLanguageDisplayName("Main.PY")).toBe("Python");
  });

  it("falls back to the extension in caps rather than 'unknown'", () => {
    expect(getLanguageDisplayName("weird.qqq")).toBe("QQQ");
  });

  it("never returns empty", () => {
    expect(getLanguageDisplayName("")).toBe("Plain Text");
    expect(getLanguageDisplayName("noext")).toBe("NOEXT");
  });
});
