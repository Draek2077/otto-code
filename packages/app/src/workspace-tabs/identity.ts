import type { WorkspaceTabTarget } from "@/stores/workspace-tabs-store";
import {
  normalizeWorkspaceFileLocation,
  workspaceFileTabTargetsEqual,
} from "@/workspace/file-open";

type WorkspaceDraftTabSetup = NonNullable<Extract<WorkspaceTabTarget, { kind: "draft" }>["setup"]>;

// oxlint-disable-next-line complexity
export function normalizeWorkspaceTabTarget(
  value: WorkspaceTabTarget | null | undefined,
): WorkspaceTabTarget | null {
  if (!value || typeof value !== "object" || typeof value.kind !== "string") {
    return null;
  }
  if (value.kind === "draft") {
    const draftId = trimNonEmpty(value.draftId);
    if (!draftId) {
      return null;
    }
    const setup = normalizeWorkspaceDraftTabSetup(value.setup);
    return setup ? { kind: "draft", draftId, setup } : { kind: "draft", draftId };
  }
  if (value.kind === "agent") {
    const agentId = trimNonEmpty(value.agentId);
    return agentId ? { kind: "agent", agentId } : null;
  }
  if (value.kind === "terminal") {
    const terminalId = trimNonEmpty(value.terminalId);
    return terminalId ? { kind: "terminal", terminalId } : null;
  }
  if (value.kind === "browser") {
    const browserId = trimNonEmpty(value.browserId);
    return browserId ? { kind: "browser", browserId } : null;
  }
  if (value.kind === "file") {
    return normalizeFileTabTarget(value);
  }
  if (value.kind === "setup") {
    const workspaceId = trimNonEmpty(value.workspaceId);
    return workspaceId ? { kind: "setup", workspaceId } : null;
  }
  if (value.kind === "artifact") {
    const artifactId = trimNonEmpty(value.artifactId);
    return artifactId ? { kind: "artifact", artifactId } : null;
  }
  if (value.kind === "gitLog") {
    const operation = trimNonEmpty(value.operation);
    return operation ? { kind: "gitLog", operation } : null;
  }
  if (value.kind === "visualizer") {
    const runId = trimNonEmpty(value.runId);
    return runId ? { kind: "visualizer", runId } : { kind: "visualizer" };
  }
  if (value.kind === "contextManagement") {
    return { kind: "contextManagement" };
  }
  return null;
}

export function normalizeWorkspaceDraftTabSetup(
  value: unknown,
): WorkspaceDraftTabSetup | undefined {
  const record = isPlainRecord(value) ? value : null;
  if (!record) {
    return undefined;
  }
  const provider = trimNonEmpty(typeof record.provider === "string" ? record.provider : null);
  const cwd = trimNonEmpty(typeof record.cwd === "string" ? record.cwd : null);
  if (!provider || !cwd) {
    return undefined;
  }
  return {
    provider,
    cwd,
    modeId: trimOptionalString(typeof record.modeId === "string" ? record.modeId : null),
    model: trimOptionalString(typeof record.model === "string" ? record.model : null),
    thinkingOptionId: trimOptionalString(
      typeof record.thinkingOptionId === "string" ? record.thinkingOptionId : null,
    ),
    featureValues: isPlainRecord(record.featureValues) ? { ...record.featureValues } : {},
  };
}

// Kinds whose equality is "same single id field" — everything except draft
// (two fields), file (its own equality fn), and visualizer (optional runId).
// Kept as a lookup rather than another `if (left.kind === X && right.kind
// === X)` branch per kind to stay under the cyclomatic-complexity ceiling.
const SIMPLE_ID_FIELD_BY_KIND: Partial<Record<WorkspaceTabTarget["kind"], string>> = {
  agent: "agentId",
  terminal: "terminalId",
  browser: "browserId",
  setup: "workspaceId",
  artifact: "artifactId",
  gitLog: "operation",
};

export function workspaceTabTargetsEqual(
  left: WorkspaceTabTarget,
  right: WorkspaceTabTarget,
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "draft" && right.kind === "draft") {
    return left.draftId === right.draftId && workspaceDraftTabSetupsEqual(left.setup, right.setup);
  }
  if (left.kind === "file" && right.kind === "file") {
    return workspaceFileTabTargetsEqual(left, right);
  }
  // Two visualizer targets are the same tab only when they're scoped to the
  // same run (or both workspace-wide, no runId).
  if (left.kind === "visualizer" && right.kind === "visualizer") {
    return left.runId === right.runId;
  }
  // Singleton per workspace — kind alone settles identity.
  if (left.kind === "contextManagement") {
    return true;
  }
  const field = SIMPLE_ID_FIELD_BY_KIND[left.kind];
  if (!field) {
    return false;
  }
  return (
    (left as unknown as Record<string, unknown>)[field] ===
    (right as unknown as Record<string, unknown>)[field]
  );
}

function workspaceDraftTabSetupsEqual(
  left: WorkspaceDraftTabSetup | undefined,
  right: WorkspaceDraftTabSetup | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return (
    left.provider === right.provider &&
    left.cwd === right.cwd &&
    left.modeId === right.modeId &&
    left.model === right.model &&
    left.thinkingOptionId === right.thinkingOptionId &&
    recordsShallowEqual(left.featureValues, right.featureValues)
  );
}

function recordsShallowEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) {
    return false;
  }
  for (const key of leftKeys) {
    if (!Object.hasOwn(right, key) || !Object.is(left[key], right[key])) {
      return false;
    }
  }
  return true;
}

export function buildDeterministicWorkspaceTabId(target: WorkspaceTabTarget): string {
  if (target.kind === "draft") {
    return target.draftId;
  }
  if (target.kind === "agent") {
    return `agent_${target.agentId}`;
  }
  if (target.kind === "terminal") {
    return `terminal_${target.terminalId}`;
  }
  if (target.kind === "browser") {
    return `browser_${target.browserId}`;
  }
  if (target.kind === "setup") {
    return `setup_${target.workspaceId}`;
  }
  if (target.kind === "artifact") {
    return `artifact_${target.artifactId}`;
  }
  if (target.kind === "gitLog") {
    return `gitlog_${target.operation}`;
  }
  if (target.kind === "visualizer") {
    return target.runId ? `visualizer_run_${target.runId}` : "visualizer";
  }
  if (target.kind === "contextManagement") {
    return "context-management";
  }
  // Out-of-project files are namespaced by their origin workspace so they never
  // collide with an in-project file of the same relative path (gated-multi-root).
  if (target.origin) {
    return `file_${target.origin.workspaceId}_${target.path}`;
  }
  return `file_${target.path}`;
}

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeFileTabTarget(
  value: Extract<WorkspaceTabTarget, { kind: "file" }>,
): WorkspaceTabTarget | null {
  const location = normalizeWorkspaceFileLocation(value);
  if (!location) {
    return null;
  }
  // Preserve the out-of-project origin (gated-multi-root) so the panel resolves
  // the file against its owning workspace instead of the host pane's root.
  return { kind: "file", ...location, ...(value.origin ? { origin: value.origin } : {}) };
}

function trimOptionalString(value: string | null | undefined): string | null {
  return value == null ? null : trimNonEmpty(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
