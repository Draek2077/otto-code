import { describe, expect, it } from "vitest";
import { linkedDocumentsFor, resolveLinkTarget } from "./refine-links";

describe("resolveLinkTarget", () => {
  it("resolves a relative target against the linking file's directory", () => {
    expect(resolveLinkTarget("/repo/docs", "./preview.md")).toBe("/repo/docs/preview.md");
    expect(resolveLinkTarget("/repo/docs", "../README.md")).toBe("/repo/README.md");
  });

  // A drive letter is one character before the colon; a URL scheme is two or
  // more. Getting this backwards turns every Windows absolute link into a URL.
  it("keeps a Windows absolute target and rejects a URL", () => {
    expect(resolveLinkTarget("C:/repo/docs", "C:\\repo\\notes.md")).toBe("C:/repo/notes.md");
    expect(resolveLinkTarget("/repo", "https://example.com/x.md")).toBeNull();
    expect(resolveLinkTarget("/repo", "mailto:someone@example.com")).toBeNull();
  });

  it("drops anchors and query strings, and rejects a bare anchor", () => {
    expect(resolveLinkTarget("/repo", "notes.md#section")).toBe("/repo/notes.md");
    expect(resolveLinkTarget("/repo", "#section")).toBeNull();
  });

  // Expanding ~ needs the host's home directory, which the client does not know.
  it("rejects a home-relative target", () => {
    expect(resolveLinkTarget("/repo", "~/.claude/CLAUDE.md")).toBeNull();
  });
});

describe("linkedDocumentsFor", () => {
  const absolutePath = "/repo/CLAUDE.md";

  it("finds markdown links and @imports, prose only", () => {
    const found = linkedDocumentsFor({
      absolutePath,
      content: [
        "See [preview](docs/preview.md) and [the code](src/index.ts).",
        "@./docs/testing.md is required reading.",
        "Ping @someone about it.",
      ].join("\n"),
    });
    expect(found).toEqual(["/repo/docs/preview.md", "/repo/docs/testing.md"]);
  });

  // The exclusion is written with a backslash and the wrong case on purpose:
  // the set's paths come from the daemon, so they will not match character for
  // character on Windows, and a near-miss would pin the same file twice.
  it("never returns the linking file or anything already in the set", () => {
    const found = linkedDocumentsFor({
      absolutePath,
      content: "[self](CLAUDE.md) [a](a.md) [again](./a.md) [b](b.md)",
      exclude: ["/repo\\B.MD"],
    });
    expect(found).toEqual(["/repo/a.md"]);
  });

  // An index with sixty entries would spend the whole request on context.
  it("caps how many links one document drags in", () => {
    const content = Array.from({ length: 20 }, (_, index) => `[e](e${index}.md)`).join("\n");
    expect(linkedDocumentsFor({ absolutePath, content, max: 3 })).toHaveLength(3);
  });
});
