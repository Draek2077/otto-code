import { describe, expect, it } from "vitest";
import { resolveWorkspaceForPath } from "./resolve-workspace-for-path";
import { canonicalLinkKey } from "./project-links";
import {
  resolveCrossProjectFileOpen,
  resolveEditGate,
  type CrossProjectWorkspace,
} from "./cross-project-open";

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
  it("treats relative paths as in-project", () => {
    const decision = resolveCrossProjectFileOpen({
      location: { path: "src/index.ts" },
      currentProjectId: "proj-a",
      workspaces: WORKSPACES,
      allowOutsideWorkspace: true,
    });
    expect(decision.kind).toBe("in-project");
  });

  it("treats a file inside the current project as in-project", () => {
    const decision = resolveCrossProjectFileOpen({
      location: { path: "/home/me/projects/alpha/src/index.ts" },
      currentProjectId: "proj-a",
      workspaces: WORKSPACES,
      allowOutsideWorkspace: true,
    });
    expect(decision.kind).toBe("in-project");
  });

  it("opens another project's file in place with an origin and rewritten path (link-agnostic)", () => {
    const decision = resolveCrossProjectFileOpen({
      location: { path: "/home/me/projects/beta/src/index.ts", lineStart: 12 },
      currentProjectId: "proj-a",
      workspaces: WORKSPACES,
      allowOutsideWorkspace: true,
    });
    expect(decision.kind).toBe("out-of-project");
    if (decision.kind !== "out-of-project") {
      throw new Error("expected out-of-project");
    }
    expect(decision.origin).toMatchObject({
      workspaceId: "ws-b",
      projectId: "proj-b",
      cwd: "/home/me/projects/beta",
      projectName: "Beta",
    });
    expect(decision.origin.outsideAnyProject).toBeUndefined();
    // Path rewritten relative to the owning workspace; line preserved.
    expect(decision.location).toEqual({ path: "src/index.ts", lineStart: 12 });
  });

  it("synthesizes a per-file origin for a path outside every project", () => {
    const decision = resolveCrossProjectFileOpen({
      location: { path: "/home/me/.claude/plans/next.md" },
      currentProjectId: "proj-a",
      workspaces: WORKSPACES,
      allowOutsideWorkspace: true,
    });
    expect(decision.kind).toBe("out-of-project");
    if (decision.kind !== "out-of-project") {
      throw new Error("expected out-of-project");
    }
    expect(decision.origin).toMatchObject({
      cwd: "/home/me/.claude/plans",
      outsideAnyProject: true,
    });
    expect(decision.location.path).toBe("next.md");
  });

  it("leaves a project-less path in-project when the daemon lacks the capability", () => {
    const decision = resolveCrossProjectFileOpen({
      location: { path: "/home/me/.claude/plans/next.md" },
      currentProjectId: "proj-a",
      workspaces: WORKSPACES,
      allowOutsideWorkspace: false,
    });
    expect(decision.kind).toBe("in-project");
  });
});

describe("resolveEditGate", () => {
  const linked = new Set([canonicalLinkKey("proj-a", "proj-b")]);
  const empty = new Set<string>();

  it("is free for an in-project file (no origin)", () => {
    expect(
      resolveEditGate({ origin: undefined, currentProjectId: "proj-a", linkSet: empty }),
    ).toEqual({ kind: "free" });
  });

  it("is free for a linked project's file", () => {
    const gate = resolveEditGate({
      origin: { workspaceId: "ws-b", cwd: "/home/me/projects/beta", projectId: "proj-b" },
      currentProjectId: "proj-a",
      linkSet: linked,
    });
    expect(gate).toEqual({ kind: "free" });
  });

  it("warns (suppressibly) for an unlinked other project", () => {
    const gate = resolveEditGate({
      origin: {
        workspaceId: "ws-b",
        cwd: "/home/me/projects/beta",
        projectId: "proj-b",
        projectName: "Beta",
      },
      currentProjectId: "proj-a",
      linkSet: empty,
    });
    expect(gate).toEqual({ kind: "other-project", projectName: "Beta" });
  });

  it("always warns for a file outside every project", () => {
    const gate = resolveEditGate({
      origin: {
        workspaceId: "outside:/home/me/.claude/plans",
        cwd: "/home/me/.claude/plans",
        projectId: "outside:/home/me/.claude/plans",
        outsideAnyProject: true,
      },
      currentProjectId: "proj-a",
      linkSet: linked,
    });
    expect(gate).toEqual({ kind: "outside-project" });
  });
});
