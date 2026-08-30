import type { AgentProvider } from "@otto-code/protocol/agent-types";
import type { ProjectKnowledgeTabSelection } from "@/project-knowledge/file-target";
import type { WorkspaceFileTabTarget } from "@/workspace/file-open";

export interface WorkspaceDraftTabSetup {
  provider: AgentProvider;
  cwd: string;
  modeId: string | null;
  model: string | null;
  thinkingOptionId: string | null;
  featureValues: Record<string, unknown>;
  /**
   * Personality identity inherited from the source agent. Without it a fork /
   * "new tab from this agent" opened on a raw model with no identity at all:
   * the rest of this setup becomes the form's `initialValues`, which outrank
   * device memory, so nothing else could put a personality back. Optional -
   * older persisted tabs simply don't carry one.
   */
  personality?: string | null;
}

export interface WorkspaceWorkingDiffTabTarget {
  kind: "working_diff";
  focusPath?: string;
  focusRequestId?: number;
}

export type WorkspaceTabTarget =
  | {
      kind: "draft";
      draftId: string;
      setup?: WorkspaceDraftTabSetup;
      architecturalViewDraft?: { viewId: string; draftId: string };
    }
  | { kind: "agent"; agentId: string }
  | { kind: "provider_subagent"; parentAgentId: string; subagentId: string }
  | { kind: "terminal"; terminalId: string }
  | { kind: "browser"; browserId: string }
  | WorkspaceFileTabTarget
  | WorkspaceWorkingDiffTabTarget
  | { kind: "setup"; workspaceId: string }
  | { kind: "commit_diff"; sha: string }
  | { kind: "artifact"; artifactId: string }
  // A durable staged Architectural View. Closing this tab only detaches its
  // preview; it never discards the daemon-owned draft.
  | { kind: "architecturalViewDraft"; viewId: string; draftId: string }
  // A published Knowledge visual. It is a first-class workspace surface so an
  // agent can open the same document a reader would seek from Manage Knowledge.
  | { kind: "architecturalView"; viewId: string }
  // A provider-neutral communications room. This is deliberately not an AI
  // chat target: no model, agent, tool, metrics, or transcript controls apply.
  | { kind: "communicationsRoom"; providerId: string; conversationId: string; title?: string }
  // A git operation's log pane ("Git Commit"/"Git Pull"/"Git Push"). One per
  // operation per workspace; `operation` is the wire operation id.
  | { kind: "gitLog"; operation: string }
  // The Visualizer tab - a live node-graph of agent orchestration. One per
  // workspace when `runId` is absent (the page's own session tabs cover
  // per-agent switching). An orchestration Run's "Visualize" action opens a
  // separate, run-scoped tab (`runId` set) restricted to that run's agent set
  // - one per run per workspace, same as `gitLog`'s one-per-operation shape.
  | { kind: "visualizer"; runId?: string }
  // Git investigation for one file: commit history, per-commit diff, blame,
  // origin commit. A tab rather than a dialog because it is a two-pane working
  // surface (commit table + diff) you keep open while reading the file, not a
  // question you answer and dismiss. One tab per (path, scope): investigating a
  // selection is a different question from investigating the whole file, so the
  // scoped tab lives beside the unscoped one instead of replacing it.
  | { kind: "fileHistory"; path: string; startLine?: number; endLine?: number }
  // Every reference to one symbol, as a results tab. A tab rather than a dialog for the
  // same reason as fileHistory: it is a working surface you navigate FROM and keep open,
  // and a dialog would be dismissed by the very act of visiting a hit. One tab per
  // (path, line, column) - a second search must not evict the first, or "look at these
  // two call sites" becomes impossible.
  | { kind: "codeReferences"; path: string; line: number; column: number; symbol: string }
  // A rename set up as a JOB: the request is taken from the file, and the tab shows the full
  // dry run - every file and every edit it would make - before anything happens. A tab and
  // not an inline rename box, deliberately: an inline box hides project-wide blast radius
  // behind a single keystroke. One per (path, line, column), like references.
  | {
      kind: "codeRename";
      path: string;
      line: number;
      column: number;
      symbol: string;
      newName: string;
    }
  // An AI rewrite of one document set up as a JOB, in the same spirit as
  // codeRename: the proposal is shown as a diff against the file as it was, the
  // user keeps the parts they want, and NOTHING is written until Accept. A tab
  // and not a mode on the editor, deliberately - a diff you decide on wants the
  // whole frame, and a mode would have to be un-persisted on every reload
  // because the pinned base only exists in memory. One tab per path: refining
  // the same document again supersedes the first job rather than sitting beside
  // it. `presetId` lets a surface that already knows what it is asking for
  // (Context Management) seed the instruction.
  //
  // A SET of paths, not one: the rewrites people want are frequently not local
  // to a file (compacting a memory index means moving detail into the entries
  // it points at). `paths` are rewritable and `paths[0]` names the tab;
  // `references` are read-only context, so a rewrite can be made in the context
  // of the project without that context becoming editable. All absolute - a
  // context set legitimately spans repo and home files.
  | {
      kind: "refine";
      paths: string[];
      references?: string[];
      presetId?: string;
    }
  // Context Management - everything the provider sends before the user types.
  // One per workspace: the report is a property of the workspace and its
  // provider, so a second tab would show the same thing.
  | { kind: "contextManagement" }
  | { kind: "projectKnowledge"; selection?: ProjectKnowledgeTabSelection }
  // The orchestration graph designer (projects/orchestration-graphs): edit one
  // reusable graph template in a node-editor canvas. One tab per graph per
  // workspace. `runId` carries the Draft orchestration the dialog minted so
  // the designer's Run action can execute it in place.
  | { kind: "orchestrationGraph"; graphId: string; runId?: string };

export interface WorkspaceTab {
  tabId: string;
  target: WorkspaceTabTarget;
  createdAt: number;
}

export function buildWorkspaceTabPersistenceKey(input: {
  serverId: string;
  workspaceId: string;
}): string | null {
  const serverId = input.serverId.trim();
  const workspaceId = input.workspaceId.trim();
  if (!serverId || !workspaceId) {
    return null;
  }
  return `${serverId}:${workspaceId}`;
}
