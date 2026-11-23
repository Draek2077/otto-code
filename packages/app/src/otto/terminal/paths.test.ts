import { describe, expect, it } from "vitest";
import { createTerminalPathOpener, terminalLinkCandidate, type TerminalPathClient } from "./paths";

describe("terminal path activation", () => {
  it("classifies terminal text without host I/O", () => {
    expect(
      terminalLinkCandidate(
        { text: "src/main.ts:12", path: "src/main.ts", lineStart: 12 },
        "/project",
      ),
    ).toMatchObject({ path: "/project/src/main.ts", lineStart: 12 });
    expect(
      terminalLinkCandidate(
        { text: "https://example.test", path: "https://example.test" },
        "/project",
      ),
    ).toBeNull();
  });
  it("opens a real directory destination rather than a file tab", async () => {
    const files: unknown[] = [];
    const directories: string[] = [];
    const reads: string[] = [];
    const client: TerminalPathClient = {
      listDirectory: async (_root, path) => {
        reads.push(path);
        return [];
      },
      getDirectorySuggestions: async () => {
        throw new Error("must not fuzz a directory");
      },
    };
    const opener = createTerminalPathOpener({
      root: "/project",
      client,
      openFile: (file) => {
        files.push(file);
      },
      openDirectory: (path) => {
        directories.push(path);
      },
    });
    await opener.open({ path: "/project/src/config.d" }, "main");
    expect(reads).toEqual(["src/config.d"]);
    expect(directories).toEqual(["src/config.d"]);
    expect(files).toEqual([]);
  });
  it("preserves line positions and side-pane intent while resolving a file", async () => {
    const files: unknown[] = [];
    const client: TerminalPathClient = {
      listDirectory: async () => {
        throw new Error("not a folder");
      },
      getDirectorySuggestions: async () => ({
        entries: [{ kind: "file", path: "src/main.ts" }],
        error: null,
      }),
    };
    const opener = createTerminalPathOpener({
      root: "/project",
      client,
      openFile: (file) => {
        files.push(file);
      },
      openDirectory: () => {
        throw new Error("must open file");
      },
    });
    await opener.open({ path: "main.ts", lineStart: 12, lineEnd: 14 }, "side");
    expect(files).toEqual([
      {
        location: { path: "/project/src/main.ts", lineStart: 12, lineEnd: 14 },
        disposition: "side",
      },
    ]);
  });
  it("does not open a stale directory response after the pane changes", async () => {
    let settle!: () => void;
    const pending = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const directories: string[] = [];
    const client: TerminalPathClient = {
      listDirectory: async () => pending,
      getDirectorySuggestions: async () => ({ entries: [], error: null }),
    };
    const opener = createTerminalPathOpener({
      root: "/project",
      client,
      openFile: () => {},
      openDirectory: (path) => {
        directories.push(path);
      },
    });
    const open = opener.open({ path: "/project/src" }, "main");
    opener.cancel();
    settle();
    await open;
    expect(directories).toEqual([]);
  });
});
