import { describe, expect, it } from "vitest";
import {
  buildAbsoluteExplorerPath,
  explorerBaseName,
  explorerParentPath,
  joinExplorerPath,
} from "./explorer-paths";

describe("buildAbsoluteExplorerPath", () => {
  it("builds a POSIX absolute path from a relative explorer path", () => {
    expect(
      buildAbsoluteExplorerPath({
        workspaceRoot: "/workspaces/otto",
        entryPath: "packages/app/src/components/file-explorer-pane.tsx",
      }),
    ).toBe("/workspaces/otto/packages/app/src/components/file-explorer-pane.tsx");
  });

  it("returns workspace root when entry path points to explorer root", () => {
    expect(
      buildAbsoluteExplorerPath({
        workspaceRoot: "/workspaces/otto",
        entryPath: ".",
      }),
    ).toBe("/workspaces/otto");
  });

  it("trims trailing separators from workspace root before joining", () => {
    expect(
      buildAbsoluteExplorerPath({
        workspaceRoot: "/workspaces/otto/",
        entryPath: "README.md",
      }),
    ).toBe("/workspaces/otto/README.md");
  });

  it("builds a Windows absolute path with backslash separators", () => {
    expect(
      buildAbsoluteExplorerPath({
        workspaceRoot: "C:\\repo\\otto",
        entryPath: "packages/app/src/components/file-explorer-pane.tsx",
      }),
    ).toBe("C:\\repo\\otto\\packages\\app\\src\\components\\file-explorer-pane.tsx");
  });

  it("passes through an already-absolute entry path", () => {
    expect(
      buildAbsoluteExplorerPath({
        workspaceRoot: "/workspaces/otto",
        entryPath: "/tmp/another/location.txt",
      }),
    ).toBe("/tmp/another/location.txt");
  });
});

// These three decide where a created entry lands and what a rename addresses, so
// the root case ("." rather than "") is the one worth pinning: an empty parent
// would give `joinExplorerPath` a leading slash and turn a workspace-relative
// path into an absolute one at the daemon.
describe("explorerParentPath", () => {
  it("returns '.' for a top-level entry", () => {
    expect(explorerParentPath("notes.md")).toBe(".");
  });

  it("returns the containing directory for a nested entry", () => {
    expect(explorerParentPath("src/components/tree.tsx")).toBe("src/components");
  });
});

describe("explorerBaseName", () => {
  it("returns the leaf name", () => {
    expect(explorerBaseName("src/components/tree.tsx")).toBe("tree.tsx");
    expect(explorerBaseName("notes.md")).toBe("notes.md");
  });
});

describe("joinExplorerPath", () => {
  it("drops the root marker instead of prefixing it", () => {
    expect(joinExplorerPath(".", "notes.md")).toBe("notes.md");
    expect(joinExplorerPath("", "notes.md")).toBe("notes.md");
  });

  it("joins a nested parent with a forward slash", () => {
    expect(joinExplorerPath("src/components", "tree.tsx")).toBe("src/components/tree.tsx");
  });

  it("round-trips with the two accessors", () => {
    expect(joinExplorerPath(explorerParentPath("a/b/c.ts"), explorerBaseName("a/b/c.ts"))).toBe(
      "a/b/c.ts",
    );
  });
});
