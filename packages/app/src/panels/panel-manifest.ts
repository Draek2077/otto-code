import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export type PaneHost = "main" | "explorer";

export interface PanelManifest<K extends WorkspaceTabTarget["kind"] = WorkspaceTabTarget["kind"]> {
  kind: K;
  supportedHosts: readonly PaneHost[];
  resourceKey(target: Extract<WorkspaceTabTarget, { kind: K }>): string;
}

type PanelManifestByKind = {
  [K in WorkspaceTabTarget["kind"]]: PanelManifest<K>;
};

const manifests = {
  new_tab: {
    kind: "new_tab",
    supportedHosts: ["main", "explorer"],
    resourceKey: () => "new_tab",
  },
  draft: {
    kind: "draft",
    supportedHosts: ["main", "explorer"],
    resourceKey: (target) => target.draftId,
  },
  agent: {
    kind: "agent",
    supportedHosts: ["main", "explorer"],
    resourceKey: (target) => target.agentId,
  },
  provider_subagent: {
    kind: "provider_subagent",
    supportedHosts: ["main", "explorer"],
    resourceKey: (target) => `${target.parentAgentId}:${target.subagentId}`,
  },
  terminal: {
    kind: "terminal",
    supportedHosts: ["main", "explorer"],
    resourceKey: (target) => target.terminalId,
  },
  browser: {
    kind: "browser",
    supportedHosts: ["main"],
    resourceKey: (target) => target.browserId,
  },
  changes_tree: {
    kind: "changes_tree",
    supportedHosts: ["explorer"],
    resourceKey: () => "changes_tree",
  },
  files: {
    kind: "files",
    supportedHosts: ["explorer"],
    resourceKey: () => "files",
  },
  pull_request: {
    kind: "pull_request",
    supportedHosts: ["main", "explorer"],
    resourceKey: () => "pull_request",
  },
  file: {
    kind: "file",
    supportedHosts: ["main", "explorer"],
    resourceKey: (target) => target.path,
  },
  working_diff: {
    kind: "working_diff",
    supportedHosts: ["main", "explorer"],
    resourceKey: () => "working_diff",
  },
  plugin: {
    kind: "plugin",
    // Plugin targets are narrowed by the target-aware plugin panel capability resolver.
    supportedHosts: ["main", "explorer"],
    resourceKey: (target) =>
      target.context === "agent"
        ? `${target.pluginId}:${target.panelId}:agent:${target.agentId}`
        : `${target.pluginId}:${target.panelId}:workspace`,
  },
  setup: {
    kind: "setup",
    supportedHosts: ["main"],
    resourceKey: (target) => target.workspaceId,
  },
  commit_diff: {
    kind: "commit_diff",
    supportedHosts: ["main", "explorer"],
    resourceKey: (target) => target.sha,
  },
  // --- Otto tab kinds ---
  artifact: {
    kind: "artifact",
    supportedHosts: ["main", "explorer"],
    resourceKey: (target) => target.artifactId,
  },
  architecturalView: {
    kind: "architecturalView",
    supportedHosts: ["main", "explorer"],
    resourceKey: (target) => target.viewId,
  },
  architecturalViewDraft: {
    kind: "architecturalViewDraft",
    supportedHosts: ["main", "explorer"],
    // Keyed by draft, not view: two drafts of one view are two tabs.
    resourceKey: (target) => target.draftId,
  },
  communicationsRoom: {
    kind: "communicationsRoom",
    supportedHosts: ["main", "explorer"],
    resourceKey: (target) => `${target.providerId}:${target.conversationId}`,
  },
  gitLog: {
    kind: "gitLog",
    // One tab per operation.
    supportedHosts: ["main", "explorer"],
    resourceKey: (target) => target.operation,
  },
  visualizer: {
    kind: "visualizer",
    // One per workspace, plus one per run when a run is being visualized.
    supportedHosts: ["main"],
    resourceKey: (target) => target.runId ?? "workspace",
  },
  fileHistory: {
    kind: "fileHistory",
    // Investigating a selection is a different question from investigating the
    // whole file, so the scoped tab lives beside the unscoped one.
    supportedHosts: ["main", "explorer"],
    resourceKey: (target) =>
      target.startLine === undefined && target.endLine === undefined
        ? target.path
        : `${target.path}:${target.startLine ?? ""}-${target.endLine ?? ""}`,
  },
  codeReferences: {
    kind: "codeReferences",
    // One tab per call site, so a second search cannot evict the first.
    supportedHosts: ["main", "explorer"],
    resourceKey: (target) => `${target.path}:${target.line}:${target.column}`,
  },
  codeRename: {
    kind: "codeRename",
    supportedHosts: ["main", "explorer"],
    resourceKey: (target) => `${target.path}:${target.line}:${target.column}`,
  },
  refine: {
    kind: "refine",
    // A refine job is identified by the set of files it was taken from.
    supportedHosts: ["main", "explorer"],
    resourceKey: (target) => [...target.paths].sort().join("|"),
  },
  contextManagement: {
    kind: "contextManagement",
    // One per workspace: the report is a property of the workspace.
    supportedHosts: ["main", "explorer"],
    resourceKey: () => "context_management",
  },
  projectKnowledge: {
    kind: "projectKnowledge",
    // One per workspace; the selection navigates within the open tab.
    supportedHosts: ["main", "explorer"],
    resourceKey: () => "project_knowledge",
  },
  orchestrationGraph: {
    kind: "orchestrationGraph",
    supportedHosts: ["main"],
    resourceKey: (target) => target.graphId,
  },
} satisfies PanelManifestByKind;

export function getPanelManifest<K extends WorkspaceTabTarget["kind"]>(kind: K): PanelManifest<K> {
  return manifests[kind] as unknown as PanelManifest<K>;
}

export function panelSupportsHost(kind: WorkspaceTabTarget["kind"], host: PaneHost): boolean {
  return getPanelManifest(kind).supportedHosts.includes(host);
}

export function panelResourceKey(target: WorkspaceTabTarget): string {
  const manifest = getPanelManifest(target.kind);
  return `${target.kind}:${manifest.resourceKey(target as never)}`;
}
