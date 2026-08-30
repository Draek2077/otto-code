import { describe, expect, it } from "vitest";
import type { WorkspaceFileOrigin } from "@/workspace/file-open";
import type { WorkspaceTabTarget } from "@/stores/workspace-tabs-store";
import {
  buildDeterministicWorkspaceTabId,
  normalizeWorkspaceTabTarget,
  workspaceTabTargetsEqual,
} from "@/workspace-tabs/identity";

const ORIGIN: WorkspaceFileOrigin = {
  workspaceId: "ws_other",
  cwd: "/repos/other",
  projectId: "proj_other",
  projectName: "Other",
};

describe("Architectural View draft tab identity", () => {
  const target = {
    kind: "architecturalViewDraft",
    viewId: "workflows",
    draftId: "workflows-revision-2",
  } as const;

  it("requires both durable ids and keys the preview by their pair", () => {
    expect(normalizeWorkspaceTabTarget(target)).toEqual(target);
    expect(normalizeWorkspaceTabTarget({ ...target, viewId: " " })).toBeNull();
    expect(workspaceTabTargetsEqual(target, { ...target })).toBe(true);
    expect(workspaceTabTargetsEqual(target, { ...target, draftId: "workflows-revision-3" })).toBe(
      false,
    );
    expect(buildDeterministicWorkspaceTabId(target)).toBe(
      "architectural-view-draft_workflows_workflows-revision-2",
    );
  });

  it("keeps the authoring-chat draft reference while restoring a chat setup tab", () => {
    expect(
      normalizeWorkspaceTabTarget({
        kind: "draft",
        draftId: "architectural-view-workflows-workflows-revision-2",
        architecturalViewDraft: { viewId: "workflows", draftId: "workflows-revision-2" },
      }),
    ).toEqual({
      kind: "draft",
      draftId: "architectural-view-workflows-workflows-revision-2",
      architecturalViewDraft: { viewId: "workflows", draftId: "workflows-revision-2" },
    });
  });
});

describe("Published Architectural View tab identity", () => {
  it("opens one durable visual per view id", () => {
    const target = { kind: "architecturalView", viewId: "workflows" } as const;
    expect(normalizeWorkspaceTabTarget(target)).toEqual(target);
    expect(normalizeWorkspaceTabTarget({ ...target, viewId: " " })).toBeNull();
    expect(workspaceTabTargetsEqual(target, { ...target })).toBe(true);
    expect(workspaceTabTargetsEqual(target, { ...target, viewId: "runtime" })).toBe(false);
    expect(buildDeterministicWorkspaceTabId(target)).toBe("architectural-view_workflows");
  });
});

describe("normalizeWorkspaceTabTarget file origin", () => {
  it("preserves the origin of a cross-project file tab", () => {
    const normalized = normalizeWorkspaceTabTarget({
      kind: "file",
      path: "src/index.ts",
      origin: ORIGIN,
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.kind).toBe("file");
    if (normalized?.kind === "file") {
      expect(normalized.path).toBe("src/index.ts");
      expect(normalized.origin).toEqual(ORIGIN);
    }
  });

  it("omits origin for an ordinary in-project file tab", () => {
    const normalized = normalizeWorkspaceTabTarget({
      kind: "file",
      path: "src/index.ts",
    });
    expect(normalized?.kind).toBe("file");
    if (normalized?.kind === "file") {
      expect(normalized.origin).toBeUndefined();
    }
  });
});

describe("fileHistory tab targets", () => {
  it("keeps a complete line scope", () => {
    const normalized = normalizeWorkspaceTabTarget({
      kind: "fileHistory",
      path: "src/index.ts",
      startLine: 10,
      endLine: 20,
    });
    expect(normalized).toEqual({
      kind: "fileHistory",
      path: "src/index.ts",
      startLine: 10,
      endLine: 20,
    });
  });

  // A half-specified or inverted range still names a file worth investigating,
  // so it degrades to whole-file rather than dropping the tab entirely.
  it("degrades an unusable line scope to whole file", () => {
    expect(
      normalizeWorkspaceTabTarget({ kind: "fileHistory", path: "src/index.ts", startLine: 10 }),
    ).toEqual({ kind: "fileHistory", path: "src/index.ts" });
    expect(
      normalizeWorkspaceTabTarget({
        kind: "fileHistory",
        path: "src/index.ts",
        startLine: 20,
        endLine: 10,
      }),
    ).toEqual({ kind: "fileHistory", path: "src/index.ts" });
  });

  it("rejects a target with no path", () => {
    expect(normalizeWorkspaceTabTarget({ kind: "fileHistory", path: "   " })).toBeNull();
  });

  // Whole-file history and a line-scoped history are different questions, so
  // opening one must not steal the other's tab.
  it("treats whole-file and scoped history as separate tabs", () => {
    const wholeFile = { kind: "fileHistory", path: "a.ts" } as const;
    const scoped = { kind: "fileHistory", path: "a.ts", startLine: 1, endLine: 5 } as const;
    expect(workspaceTabTargetsEqual(wholeFile, wholeFile)).toBe(true);
    expect(workspaceTabTargetsEqual(wholeFile, scoped)).toBe(false);
    expect(buildDeterministicWorkspaceTabId(wholeFile)).not.toBe(
      buildDeterministicWorkspaceTabId(scoped),
    );
  });
});

describe("codeReferences tab identity", () => {
  const base = {
    kind: "codeReferences",
    path: "a.ts",
    line: 4,
    column: 10,
    symbol: "foo",
  } as const;

  // Two symbols can share a name and be entirely unrelated - which is the confusion a
  // language server exists to remove, so the tab identity must not reintroduce it.
  it("keys on position, not on the symbol name", () => {
    const sameSpotDifferentName = { ...base, symbol: "renamedInTheTitleOnly" } as const;
    const sameNameDifferentSpot = { ...base, line: 99 } as const;

    expect(workspaceTabTargetsEqual(base, sameSpotDifferentName)).toBe(true);
    expect(workspaceTabTargetsEqual(base, sameNameDifferentSpot)).toBe(false);
  });

  it("gives two searches distinct persisted ids so one cannot evict the other", () => {
    expect(buildDeterministicWorkspaceTabId(base)).not.toBe(
      buildDeterministicWorkspaceTabId({ ...base, column: 11 }),
    );
  });

  // A search has no meaningful degraded form: without a position there is nothing to
  // resolve, so a half-persisted tab is dropped rather than restored pointing at nothing.
  it("rejects a target missing any of path, symbol or position", () => {
    expect(normalizeWorkspaceTabTarget({ ...base, path: "  " })).toBeNull();
    expect(normalizeWorkspaceTabTarget({ ...base, symbol: "" })).toBeNull();
    expect(normalizeWorkspaceTabTarget({ ...base, line: 0 })).toBeNull();
    expect(normalizeWorkspaceTabTarget({ ...base, column: -1 })).toBeNull();
  });

  it("keeps a well-formed target intact", () => {
    expect(normalizeWorkspaceTabTarget(base)).toEqual(base);
  });
});

describe("refine tab identity", () => {
  const base: WorkspaceTabTarget = { kind: "refine", paths: ["/repo/docs/design.md"] };

  // One job per primary document: refining the same file again is a fresh pin of
  // it, which supersedes the first job rather than sitting beside it. Neither the
  // rest of the working set nor the preset is part of that identity.
  it("keys on the primary path alone", () => {
    expect(workspaceTabTargetsEqual(base, { ...base, presetId: "compact-context-file" })).toBe(
      true,
    );
    expect(workspaceTabTargetsEqual(base, { ...base, references: ["/repo/CLAUDE.md"] })).toBe(true);
    expect(workspaceTabTargetsEqual(base, { kind: "refine", paths: ["/repo/other.md"] })).toBe(
      false,
    );
    expect(buildDeterministicWorkspaceTabId(base)).toBe("refine_/repo/docs/design.md");
  });

  it("keeps the working set and preset, and drops a target with nothing to rewrite", () => {
    expect(
      normalizeWorkspaceTabTarget({
        kind: "refine",
        paths: ["/repo/CLAUDE.md", " ", "/repo/CLAUDE.md"],
        references: ["/repo/docs/design.md"],
        presetId: "tighten-prose",
      }),
    ).toEqual({
      kind: "refine",
      paths: ["/repo/CLAUDE.md"],
      references: ["/repo/docs/design.md"],
      presetId: "tighten-prose",
    });
    expect(normalizeWorkspaceTabTarget({ kind: "refine", paths: ["  "] })).toBeNull();
    expect(normalizeWorkspaceTabTarget({ kind: "refine", paths: [] })).toBeNull();
  });

  // A file cannot be both rewritable and read-only; being rewritable wins, since
  // the narrower role would silently shrink the blast radius the caller asked for.
  it("never lists a rewritable path as a reference as well", () => {
    expect(
      normalizeWorkspaceTabTarget({
        kind: "refine",
        paths: ["/repo/CLAUDE.md"],
        references: ["/repo/CLAUDE.md", "/repo/MEMORY.md"],
      }),
    ).toEqual({
      kind: "refine",
      paths: ["/repo/CLAUDE.md"],
      references: ["/repo/MEMORY.md"],
    });
  });
});

describe("normalizeWorkspaceTabTarget provider subagents", () => {
  // The panel, the tab menu entry and the persistence key builder all shipped
  // with the Paseo v0.2.5 merge, but this normalizer never learned the kind, so
  // every target it produced was dropped and the tab could not be opened or
  // restored. See projects/paseo-v025-merge/audit-findings.md.
  it("keeps a provider subagent target addressed by its parent and subagent pair", () => {
    expect(
      normalizeWorkspaceTabTarget({
        kind: "provider_subagent",
        parentAgentId: "agent_parent",
        subagentId: "sub_1",
      }),
    ).toEqual({
      kind: "provider_subagent",
      parentAgentId: "agent_parent",
      subagentId: "sub_1",
    });
  });

  it("drops a provider subagent target missing either half of the pair", () => {
    expect(
      normalizeWorkspaceTabTarget({
        kind: "provider_subagent",
        parentAgentId: "   ",
        subagentId: "sub_1",
      }),
    ).toBeNull();
    expect(
      normalizeWorkspaceTabTarget({
        kind: "provider_subagent",
        parentAgentId: "agent_parent",
        subagentId: "",
      }),
    ).toBeNull();
  });

  // DEFERRED(paseoDiffTab): these two kinds are inherited from Paseo's tab model
  // but have no panel registered here, so dropping them is deliberate. If a
  // panel is ever adopted, this expectation is the thing that should fail first.
  it("still drops the diff tab kinds Otto never adopted a panel for", () => {
    expect(normalizeWorkspaceTabTarget({ kind: "working_diff" })).toBeNull();
    expect(normalizeWorkspaceTabTarget({ kind: "commit_diff", sha: "abc1234" })).toBeNull();
  });
});

describe("communications room tab identity", () => {
  const room = {
    kind: "communicationsRoom" as const,
    providerId: "zoom-team-chat",
    conversationId: "channel-1",
    title: "Care coordination",
  };

  it("preserves the provider and conversation address without AI-chat fields", () => {
    expect(normalizeWorkspaceTabTarget(room)).toEqual(room);
  });

  it("keys one room by its provider and conversation rather than its title", () => {
    expect(workspaceTabTargetsEqual(room, { ...room, title: "Renamed channel" })).toBe(true);
    expect(workspaceTabTargetsEqual(room, { ...room, providerId: "another-provider" })).toBe(false);
    expect(workspaceTabTargetsEqual(room, { ...room, conversationId: "channel-2" })).toBe(false);
    expect(buildDeterministicWorkspaceTabId(room)).toBe(
      "communications-room_zoom-team-chat_channel-1",
    );
  });

  it("drops a persisted room target missing either identity half", () => {
    expect(normalizeWorkspaceTabTarget({ ...room, providerId: " " })).toBeNull();
    expect(normalizeWorkspaceTabTarget({ ...room, conversationId: " " })).toBeNull();
  });
});

describe("Project Knowledge tab selection", () => {
  it("keeps one Knowledge tab while allowing a new article selection to retarget it", () => {
    const architecture = {
      kind: "projectKnowledge" as const,
      selection: { kind: "root" as const, slug: "architecture" },
    };
    const record = {
      kind: "projectKnowledge" as const,
      selection: { kind: "record" as const, id: "editor-canvas" },
    };

    expect(normalizeWorkspaceTabTarget(architecture)).toEqual(architecture);
    expect(workspaceTabTargetsEqual(architecture, record)).toBe(false);
    expect(buildDeterministicWorkspaceTabId(architecture)).toBe("project-knowledge");
    expect(buildDeterministicWorkspaceTabId(record)).toBe("project-knowledge");
  });
});
