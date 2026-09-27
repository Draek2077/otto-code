import { describe, expect, it } from "vitest";
import {
  canonicalFileIdentity,
  FileCollisionIndex,
  type FileTouch,
} from "./visualizer-file-collisions";

function touch(overrides: Partial<FileTouch> = {}): FileTouch {
  return {
    callId: "call-1",
    sessionId: "chat-1",
    agent: "Agent A",
    path: "/project/src/a.ts",
    displayPath: "src/a.ts",
    mode: "read",
    atMs: 1_000_000,
    ...overrides,
  };
}

describe("Visualizer file collisions", () => {
  it("resolves Windows case and relative paths without merging separate worktrees", () => {
    expect(canonicalFileIdentity("src\\..\\src\\A.ts", "C:\\Project")).toBe("c:/project/src/a.ts");
    expect(canonicalFileIdentity("C:/PROJECT/src/a.ts")).toBe("c:/project/src/a.ts");
    expect(canonicalFileIdentity("src/a.ts", "C:/Other")).toBe("c:/other/src/a.ts");
    expect(canonicalFileIdentity("src/a.ts")).toBeNull();
  });

  it("reports read/write overlap between agents, including out-of-order history", () => {
    const index = new FileCollisionIndex();
    expect(index.add(touch())).toEqual([]);
    expect(
      index.add(touch({ callId: "call-2", sessionId: "chat-2", agent: "Agent B", atMs: 990_000 })),
    ).toEqual([]);
    const collisions = index.add(
      touch({
        callId: "call-3",
        sessionId: "chat-2",
        agent: "Agent B",
        mode: "write",
        atMs: 995_000,
      }),
    );
    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.id).toContain("chat-1:Agent A:call-1");
    expect(
      index.add(touch({ callId: "call-3", sessionId: "chat-2", agent: "Agent B", mode: "write" })),
    ).toEqual([]);
  });

  it("ignores the same agent, distant touches, and different physical files", () => {
    const index = new FileCollisionIndex();
    index.add(touch({ mode: "write" }));
    expect(index.add(touch({ callId: "call-2", mode: "read" }))).toEqual([]);
    expect(index.add(touch({ callId: "call-3", agent: "Agent B", atMs: 1_100_001 }))).toEqual([]);
    expect(
      index.add(touch({ callId: "call-4", agent: "Agent B", path: "/other/src/a.ts" })),
    ).toEqual([]);
  });
});
