import { describe, expect, it } from "vitest";
import { resolveWorkspaceForPath } from "./resolve-workspace-for-path";
import { canonicalLinkKey } from "./project-links";
import { resolveCrossProjectFileOpen, type CrossProjectWorkspace } from "./cross-project-open";

const WORKSPACES: CrossProjectWorkspace[] = [
  {
    workspaceId: "ws-a",
    projectId: "proj-a",
    cwd: "/home/me/projects/alpha",
    projectName: "Alpha",
  },
  { workspaceId: "ws-b", projectId: "proj-b", cwd: "/home/me/projects/beta", projectName: "Beta" },
  // A worktree nested under alpha — the more specific root must win.
  {
    workspaceId: "ws-a-wt",
    projectId: "proj-a",
    cwd: "/home/me/projects/alpha/.worktrees/feature",
    projectName: "Alpha",
  },
];

describe("resolveWorkspaceForPath", () => {
  it("attributes a path to the workspace that contains it", () => {
    const resolved = resolveWorkspaceForPath("/home/me/projects/beta/src/index.ts", WORKSPACES);
    expect(resolved?.workspaceId).toBe("ws-b");
    expect(resolved?.relativePath).toBe("src/index.ts");
  });

  it("prefers the most specific (longest) workspace root", () => {
    const resolved = resolveWorkspaceForPath(
      "/home/me/projects/alpha/.worktrees/feature/app.ts",
      WORKSPACES,
    );
    expect(resolved?.workspaceId).toBe("ws-a-wt");
    expect(resolved?.relativePath).toBe("app.ts");
  });

  it("returns null for a path outside every known workspace", () => {
    expect(resolveWorkspaceForPath("/etc/passwd", WORKSPACES)).toBeNull();
  });

  it("folds Windows drive-letter casing and backslashes", () => {
    const win: CrossProjectWorkspace[] = [
      { workspaceId: "w", projectId: "p", cwd: "C:\\Users\\Me\\repo", projectName: "Repo" },
    ];
    const resolved = resolveWorkspaceForPath("c:/users/me/repo/src/main.ts", win);
    expect(resolved?.workspaceId).toBe("w");
    expect(resolved?.relativePath).toBe("src/main.ts");
  });
});

describe("resolveCrossProjectFileOpen", () => {
  const linked = new Set([canonicalLinkKey("proj-a", "proj-b")]);
  const empty = new Set<string>();

  it("treats relative paths as in-project", () => {
    const decision = resolveCrossProjectFileOpen({
      location: { path: "src/index.ts" },
      currentProjectId: "proj-a",
      workspaces: WORKSPACES,
      linkSet: linked,
    });
    expect(decision.kind).toBe("in-project");
  });

  it("treats a file inside the current project as in-project", () => {
    const decision = resolveCrossProjectFileOpen({
      location: { path: "/home/me/projects/alpha/src/index.ts" },
      currentProjectId: "proj-a",
      workspaces: WORKSPACES,
      linkSet: empty,
    });
    expect(decision.kind).toBe("in-project");
  });

  it("opens a linked project's file in place with an origin and rewritten path", () => {
    const decision = resolveCrossProjectFileOpen({
      location: { path: "/home/me/projects/beta/src/index.ts", lineStart: 12 },
      currentProjectId: "proj-a",
      workspaces: WORKSPACES,
      linkSet: linked,
    });
    expect(decision.kind).toBe("linked");
    if (decision.kind !== "linked") {
      throw new Error("expected linked");
    }
    expect(decision.origin).toMatchObject({
      workspaceId: "ws-b",
      projectId: "proj-b",
      cwd: "/home/me/projects/beta",
      projectName: "Beta",
    });
    // Path rewritten relative to the owning workspace; line preserved.
    expect(decision.location).toEqual({ path: "src/index.ts", lineStart: 12 });
  });

  it("blocks an unlinked project's file, naming the owner", () => {
    const decision = resolveCrossProjectFileOpen({
      location: { path: "/home/me/projects/beta/src/index.ts" },
      currentProjectId: "proj-a",
      workspaces: WORKSPACES,
      linkSet: empty,
    });
    expect(decision).toEqual({ kind: "blocked", projectName: "Beta" });
  });

  it("treats a path outside every known workspace as in-project (daemon guards it)", () => {
    const decision = resolveCrossProjectFileOpen({
      location: { path: "/tmp/stranger.ts" },
      currentProjectId: "proj-a",
      workspaces: WORKSPACES,
      linkSet: empty,
    });
    expect(decision.kind).toBe("in-project");
  });
});
