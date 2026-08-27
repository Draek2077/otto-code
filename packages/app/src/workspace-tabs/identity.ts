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
  // Both ids are required: the tab is identified by the pair, and a subagent id
  // without its parent cannot be resolved back to a timeline.
  if (value.kind === "provider_subagent") {
    const parentAgentId = trimNonEmpty(value.parentAgentId);
    const subagentId = trimNonEmpty(value.subagentId);
    return parentAgentId && subagentId
      ? { kind: "provider_subagent", parentAgentId, subagentId }
      : null;
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
  if (value.kind === "communicationsRoom") {
    const providerId = trimNonEmpty(value.providerId);
    const conversationId = trimNonEmpty(value.conversationId);
    const title = trimNonEmpty(value.title);
    return providerId && conversationId
      ? { kind: "communicationsRoom", providerId, conversationId, ...(title ? { title } : {}) }
      : null;
  }
  if (value.kind === "gitLog") {
    const operation = trimNonEmpty(value.operation);
    return operation ? { kind: "gitLog", operation } : null;
  }
  if (value.kind === "fileHistory") {
    return normalizeFileHistoryTabTarget(value);
  }
  if (value.kind === "codeReferences") {
    return normalizeCodeReferencesTabTarget(value);
  }
  if (value.kind === "codeRename") {
    return normalizeCodeRenameTabTarget(value);
  }
  if (value.kind === "refine") {
    return normalizeRefineTabTarget(value);
  }
  if (value.kind === "visualizer") {
    const runId = trimNonEmpty(value.runId);
    return runId ? { kind: "visualizer", runId } : { kind: "visualizer" };
  }
  if (value.kind === "contextManagement") {
    return { kind: "contextManagement" };
  }
  if (value.kind === "projectKnowledge") return { kind: "projectKnowledge" };
  if (value.kind === "orchestrationGraph") {
    const graphId = trimNonEmpty(value.graphId);
    if (!graphId) {
      return null;
    }
    const runId = trimNonEmpty(value.runId);
    return runId
      ? { kind: "orchestrationGraph", graphId, runId }
      : { kind: "orchestrationGraph", graphId };
  }
  // DEFERRED(paseoDiffTab): `working_diff` and `commit_diff` are in the target
  // union because Otto inherits Paseo's tab model wholesale, but neither has a
  // registered panel here - we kept our own Changes view instead of adopting
  // their diff tabs. Normalizing them would hand the store a target that opens
  // an empty pane, so they deliberately fall through to null. This is NOT the
  // same bug as `provider_subagent` above, which does have a panel and was only
  // missing this branch. Adopt the panels first, then add the branches.
  return null;
}

/**
 * A file-history target keeps its line scope only when both ends are present
 * and sane; a half-specified range degrades to whole-file rather than being
 * dropped, since the file is still the thing the user asked about.
 */
function normalizeFileHistoryTabTarget(
  value: Extract<WorkspaceTabTarget, { kind: "fileHistory" }>,
): WorkspaceTabTarget | null {
  const path = trimNonEmpty(value.path);
  if (!path) {
    return null;
  }
  const startLine = normalizePositiveInteger(value.startLine);
  const endLine = normalizePositiveInteger(value.endLine);
  if (startLine === null || endLine === null || endLine < startLine) {
    return { kind: "fileHistory", path };
  }
  return { kind: "fileHistory", path, startLine, endLine };
}

/**
 * A references tab needs all four fields to mean anything: the position is what was asked
 * about, and the symbol is what the tab is called. Unlike `fileHistory`, a bad position
 * cannot degrade to "the whole file" - there is no such search - so it drops the tab.
 */
function normalizeCodeReferencesTabTarget(
  value: Extract<WorkspaceTabTarget, { kind: "codeReferences" }>,
): WorkspaceTabTarget | null {
  const path = trimNonEmpty(value.path);
  const symbol = trimNonEmpty(value.symbol);
  const line = normalizePositiveInteger(value.line);
  const column = normalizePositiveInteger(value.column);
  if (!path || !symbol || line === null || column === null) {
    return null;
  }
  return { kind: "codeReferences", path, line, column, symbol };
}

type PathKeyedTarget = Extract<WorkspaceTabTarget, { kind: "fileHistory" | "refine" }>;

function isPathKeyedTarget(value: WorkspaceTabTarget): value is PathKeyedTarget {
  return value.kind === "fileHistory" || value.kind === "refine";
}

function pathKeyedTargetsEqual(left: PathKeyedTarget, right: PathKeyedTarget): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "refine" && right.kind === "refine") {
    return left.paths[0] === right.paths[0];
  }
  return (
    left.kind === "fileHistory" &&
    right.kind === "fileHistory" &&
    left.path === right.path &&
    left.startLine === right.startLine &&
    left.endLine === right.endLine
  );
}

type PositionKeyedTarget = Extract<WorkspaceTabTarget, { kind: "codeReferences" | "codeRename" }>;

function isPositionKeyedTarget(value: WorkspaceTabTarget): value is PositionKeyedTarget {
  return value.kind === "codeReferences" || value.kind === "codeRename";
}

/**
 * Position, not symbol name. Two identically named symbols in different scopes are two
 * different things, and matching on the name would collapse them into one tab - precisely
 * the confusion a language server exists to remove. The kind is part of it too: a rename job
 * and a reference search on the same symbol are different tabs.
 */
function positionKeyedTargetsEqual(left: PositionKeyedTarget, right: PositionKeyedTarget): boolean {
  return (
    left.kind === right.kind &&
    left.path === right.path &&
    left.line === right.line &&
    left.column === right.column
  );
}

/**
 * Every field required, for the references reason plus one: a rename job with no new name
 * is not a job, and restoring a half-persisted one would put an Apply button in front of
 * an edit nobody described.
 */
function normalizeCodeRenameTabTarget(
  value: Extract<WorkspaceTabTarget, { kind: "codeRename" }>,
): WorkspaceTabTarget | null {
  const path = trimNonEmpty(value.path);
  const symbol = trimNonEmpty(value.symbol);
  const newName = trimNonEmpty(value.newName);
  const line = normalizePositiveInteger(value.line);
  const column = normalizePositiveInteger(value.column);
  if (!path || !symbol || !newName || line === null || column === null) {
    return null;
  }
  return { kind: "codeRename", path, line, column, symbol, newName };
}

/**
 * A refine job needs at least one rewritable document; without one there is
 * nothing the tab could ever write, so a half-persisted target is dropped
 * rather than restored as an empty session. Read-only references are optional
 * by nature - losing them costs context, not correctness.
 */
function normalizeRefineTabTarget(
  value: Extract<WorkspaceTabTarget, { kind: "refine" }>,
): WorkspaceTabTarget | null {
  const paths = normalizePathList(value.paths);
  if (paths.length === 0) {
    return null;
  }
  const references = normalizePathList(value.references).filter((path) => !paths.includes(path));
  const presetId = trimNonEmpty(value.presetId);
  return {
    kind: "refine",
    paths,
    ...(references.length > 0 ? { references } : {}),
    ...(presetId ? { presetId } : {}),
  };
}

function normalizePathList(value: readonly string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const path = trimNonEmpty(entry);
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    out.push(path);
  }
  return out;
}

function normalizePositiveInteger(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return null;
  }
  return value;
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
    personality: trimOptionalString(
      typeof record.personality === "string" ? record.personality : null,
    ),
  };
}

// Kinds whose equality is "same single id field" - everything except draft
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
  if (left.kind === "communicationsRoom" && right.kind === "communicationsRoom") {
    return communicationsRoomTargetsEqual(left, right);
  }
  // Two path-keyed kinds, sharing one branch to stay inside this function's
  // complexity ceiling:
  //   fileHistory - path PLUS scope, because whole-file history and a
  //     line-scoped history of the same file are different questions.
  //   refine - the primary path alone, because a second refine of the same
  //     document is a fresh pin of the same job and supersedes the first.
  if (isPathKeyedTarget(left) && isPathKeyedTarget(right)) {
    return pathKeyedTargetsEqual(left, right);
  }
  // Both code-intelligence tabs are keyed the same way, so they share one branch -
  // two branches here would push this function past its complexity ceiling.
  if (isPositionKeyedTarget(left) && isPositionKeyedTarget(right)) {
    return positionKeyedTargetsEqual(left, right);
  }
  // Singleton per workspace - kind alone settles identity.
  if (left.kind === "contextManagement" || left.kind === "projectKnowledge") {
    return true;
  }
  // One designer tab per graph; the draft runId doesn't change identity (the
  // dialog retargets the same tab when it attaches a draft to the graph).
  if (left.kind === "orchestrationGraph" && right.kind === "orchestrationGraph") {
    return left.graphId === right.graphId;
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

function communicationsRoomTargetsEqual(
  left: Extract<WorkspaceTabTarget, { kind: "communicationsRoom" }>,
  right: Extract<WorkspaceTabTarget, { kind: "communicationsRoom" }>,
): boolean {
  return left.providerId === right.providerId && left.conversationId === right.conversationId;
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
    (left.personality ?? null) === (right.personality ?? null) &&
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

/** Tabs whose identity is a single id the target already carries. */
const SIMPLE_TAB_ID_BUILDERS: {
  [K in WorkspaceTabTarget["kind"]]?: (target: Extract<WorkspaceTabTarget, { kind: K }>) => string;
} = {
  draft: (target) => target.draftId,
  agent: (target) => `agent_${target.agentId}`,
  terminal: (target) => `terminal_${target.terminalId}`,
  browser: (target) => `browser_${target.browserId}`,
  setup: (target) => `setup_${target.workspaceId}`,
  artifact: (target) => `artifact_${target.artifactId}`,
  communicationsRoom: (target) =>
    `communications-room_${target.providerId}_${target.conversationId}`,
  gitLog: (target) => `gitlog_${target.operation}`,
  contextManagement: () => "context-management",
  projectKnowledge: () => "project-knowledge",
  orchestrationGraph: (target) => `orchestration-graph_${target.graphId}`,
  provider_subagent: (target) => `provider-subagent_${target.parentAgentId}_${target.subagentId}`,
  commit_diff: (target) => `commit-diff_${target.sha}`,
  working_diff: () => "working-diff",
  visualizer: (target) => (target.runId ? `visualizer_run_${target.runId}` : "visualizer"),
};

/**
 * Job tabs keyed by the source location they were opened from, so a second
 * request for the same location supersedes the first rather than stacking.
 */
function buildJobTabId(target: WorkspaceTabTarget): string | null {
  if (target.kind === "fileHistory") {
    const scope =
      target.startLine !== undefined && target.endLine !== undefined
        ? `_L${target.startLine}-${target.endLine}`
        : "";
    return `filehistory_${target.path}${scope}`;
  }
  if (target.kind === "codeReferences") {
    return `coderefs_${target.path}:${target.line}:${target.column}`;
  }
  if (target.kind === "codeRename") {
    return `coderename_${target.path}:${target.line}:${target.column}`;
  }
  // The primary path alone: a second refine of the same document supersedes the
  // first, so neither the rest of the working set nor the preset is part of the
  // identity - a re-request is a fresh pin of the same job.
  if (target.kind === "refine") {
    return `refine_${target.paths[0] ?? ""}`;
  }
  return null;
}

export function buildDeterministicWorkspaceTabId(target: WorkspaceTabTarget): string {
  const simple = SIMPLE_TAB_ID_BUILDERS[target.kind] as
    | ((value: WorkspaceTabTarget) => string)
    | undefined;
  if (simple) {
    return simple(target);
  }
  const jobId = buildJobTabId(target);
  if (jobId !== null) {
    return jobId;
  }
  // External files are namespaced by their serving workspace so they never
  // collide with a pane-local file that has the same relative path.
  if (target.kind === "file" && target.origin) {
    return `file_${target.origin.workspaceId}_${target.path}`;
  }
  return `file_${target.kind === "file" ? target.path : ""}`;
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
  // Preserve the external file origin so the panel resolves the file against
  // its serving workspace instead of the host pane's root.
  return { kind: "file", ...location, ...(value.origin ? { origin: value.origin } : {}) };
}

function trimOptionalString(value: string | null | undefined): string | null {
  return value == null ? null : trimNonEmpty(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
