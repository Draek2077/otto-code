import { describe, expect, it } from "vitest";
import {
  exportMarkdownAsHtml,
  htmlExportPath,
  type HtmlExportWriter,
} from "./export-markdown-html";

/**
 * An in-memory workspace that enforces the same optimistic-concurrency rule the
 * daemon does: a write to an existing file must present that file's identity.
 * A fake with the real precondition is what makes the conflict-then-retry path
 * worth testing; a fake that always says "ok" would prove nothing.
 */
function createWorkspace(existing: Record<string, string> = {}) {
  const files = new Map(Object.entries(existing));
  const writes: Array<{ path: string; expectedModifiedAt: string }> = [];
  let clock = 0;

  const identity = (path: string) => `v${files.get(path)?.length ?? 0}`;

  const writer: HtmlExportWriter = {
    writeFile: async (options) => {
      writes.push({ path: options.path, expectedModifiedAt: options.expectedModifiedAt });
      const present = files.has(options.path);
      if (!present) {
        if (!options.allowCreate) {
          return { status: "error", message: "File no longer exists on disk" };
        }
        files.set(options.path, options.content);
        clock += 1;
        return {
          status: "ok",
          modifiedAt: `t${clock}`,
          hash: identity(options.path),
          size: 0,
          eol: "lf",
        };
      }
      if (options.expectedModifiedAt !== `t${clock}`) {
        return { status: "conflict", modifiedAt: `t${clock}`, hash: identity(options.path) };
      }
      files.set(options.path, options.content);
      clock += 1;
      return {
        status: "ok",
        modifiedAt: `t${clock}`,
        hash: identity(options.path),
        size: 0,
        eol: "lf",
      };
    },
  };

  return { writer, files, writes };
}

describe("htmlExportPath", () => {
  it("writes beside the document", () => {
    expect(htmlExportPath("notes/design.md")).toBe("notes/design.html");
  });

  it("keeps a document at the root at the root", () => {
    expect(htmlExportPath("README.md")).toBe("README.html");
  });

  it("keeps a windows path's separators", () => {
    expect(htmlExportPath("docs\\guides\\a.md")).toBe("docs\\guides\\a.html");
  });
});

describe("exportMarkdownAsHtml", () => {
  it("writes the rendered document next to the source", async () => {
    const workspace = createWorkspace();
    const result = await exportMarkdownAsHtml({
      writer: workspace.writer,
      cwd: "/repo",
      path: "docs/design.md",
      markdown: "# Design\n\nSome prose.\n",
    });

    expect(result).toEqual({ status: "written", path: "docs/design.html", title: "Design" });
    expect(workspace.files.get("docs/design.html")).toContain("<title>Design</title>");
  });

  it("exports the buffer it was given, not what is on disk", async () => {
    const workspace = createWorkspace();
    await exportMarkdownAsHtml({
      writer: workspace.writer,
      cwd: "/repo",
      path: "a.md",
      markdown: "unsaved edit\n",
    });
    expect(workspace.files.get("a.html")).toContain("unsaved edit");
  });

  // The common case is that no export exists yet, so the first write assumes so
  // and only pays for a second round trip when it turns out one does.
  it("creates without a preceding read", async () => {
    const workspace = createWorkspace();
    await exportMarkdownAsHtml({
      writer: workspace.writer,
      cwd: "/repo",
      path: "a.md",
      markdown: "# A\n",
    });
    expect(workspace.writes).toHaveLength(1);
  });

  it("overwrites a previous export using the identity the conflict reported", async () => {
    const workspace = createWorkspace({ "a.html": "<!doctype html><p>stale</p>" });
    const result = await exportMarkdownAsHtml({
      writer: workspace.writer,
      cwd: "/repo",
      path: "a.md",
      markdown: "# Fresh\n",
    });

    expect(result.status).toBe("written");
    expect(workspace.files.get("a.html")).toContain("Fresh");
    expect(workspace.files.get("a.html")).not.toContain("stale");
    // One blind attempt, then the informed overwrite.
    expect(workspace.writes.map((write) => write.expectedModifiedAt)).toEqual(["", "t0"]);
  });

  it("reports the daemon's message when the write fails", async () => {
    const writer: HtmlExportWriter = {
      writeFile: async () => ({ status: "error", message: "Permission denied" }),
    };
    expect(
      await exportMarkdownAsHtml({ writer, cwd: "/repo", path: "a.md", markdown: "# A\n" }),
    ).toEqual({ status: "error", message: "Permission denied" });
  });

  // Retrying a second time would be a loop, not a fix.
  it("gives up rather than looping when the target keeps changing", async () => {
    const writer: HtmlExportWriter = {
      writeFile: async () => ({ status: "conflict", modifiedAt: "t1", hash: "h1" }),
    };
    const result = await exportMarkdownAsHtml({
      writer,
      cwd: "/repo",
      path: "a.md",
      markdown: "# A\n",
    });
    expect(result.status).toBe("error");
  });
});
