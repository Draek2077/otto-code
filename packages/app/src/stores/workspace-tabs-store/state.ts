import {
  buildDeterministicWorkspaceTabId,
  normalizeWorkspaceDraftTabSetup,
  normalizeWorkspaceTabTarget,
  workspaceTabTargetsEqual,
} from "@/workspace-tabs/identity";
import type {
  WorkspaceDraftTabSetup as BaseWorkspaceDraftTabSetup,
  WorkspaceTabTarget as BaseWorkspaceTabTarget,
} from "@/workspace-tabs/model";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
// COMPAT(workspaceTabsStoreReexport): added in v0.7.6, remove after 2027-02-01.
// Re-exported so the call sites that import it from this store keep working;
// Paseo's model owns the implementation. This IS a shim - repointing those
// imports at `@/workspace-tabs/model` is the cleanup, and until that happens
// the next upstream merge has this indirection to undo.
export { buildWorkspaceTabPersistenceKey };
import type { WorkspaceFileOrigin } from "@/workspace/file-open";

export interface WorkspaceDraftTabSetup extends BaseWorkspaceDraftTabSetup {
  /**
   * Personality identity inherited from the source agent. Without it a fork /
   * "new tab from this agent" opened on a raw model with no identity at all:
   * the rest of this setup becomes the form's `initialValues`, which outrank
   * device memory, so nothing else could put a personality back. Optional -
   * older persisted tabs simply don't carry one.
   */
  personality?: string | null;
}

export type WorkspaceTabTarget =
  // Paseo's tab kinds are the base, so their additions (provider_subagent,
  // working_diff, commit_diff) arrive without us restating them. `draft` is the
  // one override: Otto's setup carries an inherited personality.
  | Exclude<BaseWorkspaceTabTarget, { kind: "draft" }>
  | { kind: "draft"; draftId: string; setup?: WorkspaceDraftTabSetup }
  | { kind: "artifact"; artifactId: string }
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
  | { kind: "refine"; paths: string[]; references?: string[]; presetId?: string }
  // Context Management - everything the provider sends before the user types.
  // One per workspace: the report is a property of the workspace and its
  // provider, so a second tab would show the same thing.
  | { kind: "contextManagement" }
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

export interface WorkspaceTabsCoreState {
  uiTabsByWorkspace: Record<string, WorkspaceTab[]>;
  tabOrderByWorkspace: Record<string, string[]>;
  focusedTabIdByWorkspace: Record<string, string>;
}

export const initialWorkspaceTabsCoreState: WorkspaceTabsCoreState = {
  uiTabsByWorkspace: {},
  tabOrderByWorkspace: {},
  focusedTabIdByWorkspace: {},
};

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainRecord(value) ? value : undefined;
}

function normalizeTabOrder(list: unknown): string[] {
  if (!Array.isArray(list)) {
    return [];
  }
  const next: string[] = [];
  const used = new Set<string>();
  for (const value of list) {
    const tabId = trimNonEmpty(typeof value === "string" ? value : null);
    if (!tabId || used.has(tabId)) {
      continue;
    }
    used.add(tabId);
    next.push(tabId);
  }
  return next;
}

function ensureInOrder(input: { current: string[]; tabId: string }): string[] {
  if (input.current.includes(input.tabId)) {
    return input.current;
  }
  return [...input.current, input.tabId];
}

function retargetTabAtIndex(
  tab: WorkspaceTab,
  index: number,
  targetIndex: number,
  normalizedTarget: WorkspaceTabTarget,
): WorkspaceTab {
  return index === targetIndex ? { ...tab, target: normalizedTarget } : tab;
}

function buildNextTabsForEnsure(args: {
  currentTabs: WorkspaceTab[];
  existingIndex: number;
  effectiveTabId: string;
  normalizedTarget: WorkspaceTabTarget;
  createdAt: number;
}): WorkspaceTab[] {
  const { currentTabs, existingIndex, effectiveTabId, normalizedTarget, createdAt } = args;
  if (existingIndex < 0) {
    return [...currentTabs, { tabId: effectiveTabId, target: normalizedTarget, createdAt }];
  }
  const existing = currentTabs[existingIndex];
  if (existing && workspaceTabTargetsEqual(existing.target, normalizedTarget)) {
    return currentTabs;
  }
  return currentTabs.map((tab, index) =>
    retargetTabAtIndex(tab, index, existingIndex, normalizedTarget),
  );
}

export interface EnsureTabInput {
  serverId: string;
  workspaceId: string;
  target: WorkspaceTabTarget;
  now: number;
}

export interface EnsureTabResult {
  state: WorkspaceTabsCoreState;
  tabId: string | null;
}

export function applyEnsureTab(
  state: WorkspaceTabsCoreState,
  input: EnsureTabInput,
): EnsureTabResult {
  const key = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  const normalizedTarget = normalizeWorkspaceTabTarget(input.target);
  if (!key || !normalizedTarget) {
    return { state, tabId: null };
  }

  const deterministicTabId = buildDeterministicWorkspaceTabId(normalizedTarget);
  const currentTabs = state.uiTabsByWorkspace[key] ?? [];
  const tabWithSameTarget =
    currentTabs.find((tab) => workspaceTabTargetsEqual(tab.target, normalizedTarget)) ?? null;
  const effectiveTabId = tabWithSameTarget?.tabId ?? deterministicTabId;

  const currentOrder = state.tabOrderByWorkspace[key] ?? [];
  const nextOrder = ensureInOrder({ current: currentOrder, tabId: effectiveTabId });
  const existingIndex = currentTabs.findIndex((tab) => tab.tabId === effectiveTabId);
  const nextTabs = buildNextTabsForEnsure({
    currentTabs,
    existingIndex,
    effectiveTabId,
    normalizedTarget,
    createdAt: input.now,
  });

  const uiTabsByWorkspace =
    nextTabs === currentTabs
      ? state.uiTabsByWorkspace
      : { ...state.uiTabsByWorkspace, [key]: nextTabs };
  const tabOrderByWorkspace =
    nextOrder === currentOrder
      ? state.tabOrderByWorkspace
      : { ...state.tabOrderByWorkspace, [key]: nextOrder };

  if (
    uiTabsByWorkspace === state.uiTabsByWorkspace &&
    tabOrderByWorkspace === state.tabOrderByWorkspace
  ) {
    return { state, tabId: effectiveTabId };
  }

  return {
    state: { ...state, uiTabsByWorkspace, tabOrderByWorkspace },
    tabId: effectiveTabId,
  };
}

export interface FocusTabInput {
  serverId: string;
  workspaceId: string;
  tabId: string;
}

export function applyFocusTab(
  state: WorkspaceTabsCoreState,
  input: FocusTabInput,
): WorkspaceTabsCoreState {
  const key = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  const normalizedTabId = trimNonEmpty(input.tabId);
  if (!key || !normalizedTabId) {
    return state;
  }
  if (state.focusedTabIdByWorkspace[key] === normalizedTabId) {
    return state;
  }
  return {
    ...state,
    focusedTabIdByWorkspace: {
      ...state.focusedTabIdByWorkspace,
      [key]: normalizedTabId,
    },
  };
}

export function applyOpenOrFocusTab(
  state: WorkspaceTabsCoreState,
  input: EnsureTabInput,
): EnsureTabResult {
  const ensured = applyEnsureTab(state, input);
  if (!ensured.tabId) {
    return ensured;
  }
  const focused = applyFocusTab(ensured.state, {
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    tabId: ensured.tabId,
  });
  return { state: focused, tabId: ensured.tabId };
}

export interface OpenDraftTabInput {
  serverId: string;
  workspaceId: string;
  draftId: string;
  now: number;
}

export function applyOpenDraftTab(
  state: WorkspaceTabsCoreState,
  input: OpenDraftTabInput,
): EnsureTabResult {
  const normalizedDraftId = trimNonEmpty(input.draftId);
  if (!normalizedDraftId) {
    return { state, tabId: null };
  }
  return applyOpenOrFocusTab(state, {
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    target: { kind: "draft", draftId: normalizedDraftId },
    now: input.now,
  });
}

export interface CloseTabInput {
  serverId: string;
  workspaceId: string;
  tabId: string;
}

export function applyCloseTab(
  state: WorkspaceTabsCoreState,
  input: CloseTabInput,
): WorkspaceTabsCoreState {
  const key = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  const normalizedTabId = trimNonEmpty(input.tabId);
  if (!key || !normalizedTabId) {
    return state;
  }

  const currentTabs = state.uiTabsByWorkspace[key] ?? [];
  const nextTabs = currentTabs.filter((tab) => tab.tabId !== normalizedTabId);
  const currentOrder = state.tabOrderByWorkspace[key] ?? [];
  const nextOrder = currentOrder.filter((value) => value !== normalizedTabId);

  let nextUiTabsByWorkspace: Record<string, WorkspaceTab[]>;
  if (nextTabs.length === 0) {
    const { [key]: _removed, ...rest } = state.uiTabsByWorkspace;
    nextUiTabsByWorkspace = rest;
  } else if (nextTabs.length === currentTabs.length) {
    nextUiTabsByWorkspace = state.uiTabsByWorkspace;
  } else {
    nextUiTabsByWorkspace = { ...state.uiTabsByWorkspace, [key]: nextTabs };
  }

  let nextTabOrderByWorkspace: Record<string, string[]>;
  if (nextOrder.length === 0) {
    const { [key]: _removed, ...rest } = state.tabOrderByWorkspace;
    nextTabOrderByWorkspace = rest;
  } else if (nextOrder.length === currentOrder.length) {
    nextTabOrderByWorkspace = state.tabOrderByWorkspace;
  } else {
    nextTabOrderByWorkspace = { ...state.tabOrderByWorkspace, [key]: nextOrder };
  }

  const currentFocused = state.focusedTabIdByWorkspace[key] ?? null;
  const nextFocused =
    currentFocused !== normalizedTabId ? currentFocused : (nextOrder[nextOrder.length - 1] ?? null);
  const nextFocusedByWorkspace = (() => {
    if (!nextFocused) {
      const { [key]: _removed, ...rest } = state.focusedTabIdByWorkspace;
      return rest;
    }
    return { ...state.focusedTabIdByWorkspace, [key]: nextFocused };
  })();

  const tabsChanged = nextTabs.length !== currentTabs.length;
  const orderChanged = nextOrder.length !== currentOrder.length;
  const focusChanged =
    (state.focusedTabIdByWorkspace[key] ?? null) !== (nextFocusedByWorkspace[key] ?? null);

  if (!tabsChanged && !orderChanged && !focusChanged) {
    return state;
  }

  return {
    uiTabsByWorkspace: nextUiTabsByWorkspace,
    tabOrderByWorkspace: nextTabOrderByWorkspace,
    focusedTabIdByWorkspace: nextFocusedByWorkspace,
  };
}

export interface RetargetTabInput {
  serverId: string;
  workspaceId: string;
  tabId: string;
  target: WorkspaceTabTarget;
}

export function applyRetargetTab(
  state: WorkspaceTabsCoreState,
  input: RetargetTabInput,
): EnsureTabResult {
  const key = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  const normalizedTabId = trimNonEmpty(input.tabId);
  const normalizedTarget = normalizeWorkspaceTabTarget(input.target);
  if (!key || !normalizedTabId || !normalizedTarget) {
    return { state, tabId: null };
  }

  const currentTabs = state.uiTabsByWorkspace[key] ?? [];
  const index = currentTabs.findIndex((tab) => tab.tabId === normalizedTabId);
  if (index < 0) {
    return { state, tabId: null };
  }

  const currentTarget = currentTabs[index]?.target;
  if (currentTarget && workspaceTabTargetsEqual(currentTarget, normalizedTarget)) {
    return { state, tabId: null };
  }

  const nextTabs = currentTabs.map((tab, tabIndex) =>
    tabIndex === index ? Object.assign({}, tab, { target: normalizedTarget }) : tab,
  );

  return {
    state: {
      ...state,
      uiTabsByWorkspace: { ...state.uiTabsByWorkspace, [key]: nextTabs },
    },
    tabId: normalizedTabId,
  };
}

export interface ReorderTabsInput {
  serverId: string;
  workspaceId: string;
  tabIds: string[];
}

export function applyReorderTabs(
  state: WorkspaceTabsCoreState,
  input: ReorderTabsInput,
): WorkspaceTabsCoreState {
  const key = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!key) {
    return state;
  }

  const normalized = normalizeTabOrder(input.tabIds);
  const current = state.tabOrderByWorkspace[key] ?? [];
  if (current.length === normalized.length) {
    let same = true;
    for (let i = 0; i < current.length; i += 1) {
      if (current[i] !== normalized[i]) {
        same = false;
        break;
      }
    }
    if (same) {
      return state;
    }
  }

  return {
    ...state,
    tabOrderByWorkspace: {
      ...state.tabOrderByWorkspace,
      [key]: normalized,
    },
  };
}

export interface PurgeWorkspaceInput {
  serverId: string;
  workspaceId: string;
}

export function applyPurgeWorkspace(
  state: WorkspaceTabsCoreState,
  input: PurgeWorkspaceInput,
): WorkspaceTabsCoreState {
  const key = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!key) {
    return state;
  }
  if (
    !(key in state.uiTabsByWorkspace) &&
    !(key in state.tabOrderByWorkspace) &&
    !(key in state.focusedTabIdByWorkspace)
  ) {
    return state;
  }
  const { [key]: _tabs, ...remainingUiTabsByWorkspace } = state.uiTabsByWorkspace;
  const { [key]: _order, ...remainingTabOrderByWorkspace } = state.tabOrderByWorkspace;
  const { [key]: _focused, ...remainingFocusedTabIdByWorkspace } = state.focusedTabIdByWorkspace;
  return {
    ...state,
    uiTabsByWorkspace: remainingUiTabsByWorkspace,
    tabOrderByWorkspace: remainingTabOrderByWorkspace,
    focusedTabIdByWorkspace: remainingFocusedTabIdByWorkspace,
  };
}

export function selectWorkspaceTabs(
  state: WorkspaceTabsCoreState,
  input: { serverId: string; workspaceId: string },
): WorkspaceTab[] {
  const key = buildWorkspaceTabPersistenceKey(input);
  if (!key) {
    return [];
  }
  return state.uiTabsByWorkspace[key] ?? [];
}

interface MigrationRawSources {
  rawUiTabsByWorkspace: Record<string, unknown>;
  rawFocused: Record<string, unknown>;
  rawOrder: Record<string, unknown>;
  legacyOrder: Record<string, unknown>;
}

function extractMigrationRawSources(persistedState: unknown): MigrationRawSources {
  const top = toObjectRecord(persistedState) ?? {};
  const rawState = toObjectRecord(top.state) ?? top;

  return {
    rawUiTabsByWorkspace:
      toObjectRecord(
        rawState.uiTabsByWorkspace ??
          rawState.openTabsByWorkspace ??
          top.uiTabsByWorkspace ??
          top.openTabsByWorkspace,
      ) ?? {},
    rawFocused:
      toObjectRecord(
        rawState.focusedTabIdByWorkspace ??
          rawState.lastFocusedTabByWorkspace ??
          top.focusedTabIdByWorkspace,
      ) ?? {},
    rawOrder: toObjectRecord(rawState.tabOrderByWorkspace ?? top.tabOrderByWorkspace) ?? {},
    legacyOrder:
      toObjectRecord(
        rawState.tabOrderByWorkspace ??
          rawState.tabOrderLegacyByWorkspace ??
          top.tabOrderLegacyByWorkspace,
      ) ?? {},
  };
}

// Kinds whose persisted shape is "kind + one required string id field" -
// everything except draft (extra setup object), file/editor (its own
// coercer), and visualizer (runId is optional). A lookup here (rather than
// another `if (kind === X && typeof raw.field === "string")` branch per
// kind) keeps this function under the cyclomatic-complexity ceiling.
const SIMPLE_STRING_FIELD_BY_KIND: Record<string, string> = {
  agent: "agentId",
  terminal: "terminalId",
  browser: "browserId",
  setup: "workspaceId",
  artifact: "artifactId",
  gitLog: "operation",
};

/**
 * Four fields of three shapes, which is more branching than the main coercer's
 * cyclomatic-complexity budget can absorb. The zero/empty placeholders are deliberate: the
 * normalizer rejects them, so a persisted tab missing any field is dropped rather than
 * restored pointing at nothing.
 */
function coerceCodeReferencesTabTarget(raw: Record<string, unknown>): WorkspaceTabTarget | null {
  return normalizeWorkspaceTabTarget({
    kind: "codeReferences",
    path: typeof raw.path === "string" ? raw.path : "",
    line: typeof raw.line === "number" ? raw.line : 0,
    column: typeof raw.column === "number" ? raw.column : 0,
    symbol: typeof raw.symbol === "string" ? raw.symbol : "",
  });
}

/**
 * Path plus an optional line scope, so it fits neither the single-string table
 * nor the optional-string-pair one. The zero placeholders are deliberate in the
 * same way as the references coercer: the normalizer drops a half-specified
 * range back to whole-file history rather than restoring a nonsense scope.
 */
function coerceFileHistoryTabTarget(raw: Record<string, unknown>): WorkspaceTabTarget | null {
  return normalizeWorkspaceTabTarget({
    kind: "fileHistory",
    path: typeof raw.path === "string" ? raw.path : "",
    startLine: typeof raw.startLine === "number" ? raw.startLine : undefined,
    endLine: typeof raw.endLine === "number" ? raw.endLine : undefined,
  });
}

/** Same shape as the references coercer, plus the new name the job was set up with. */
function coerceCodeRenameTabTarget(raw: Record<string, unknown>): WorkspaceTabTarget | null {
  return normalizeWorkspaceTabTarget({
    kind: "codeRename",
    path: typeof raw.path === "string" ? raw.path : "",
    line: typeof raw.line === "number" ? raw.line : 0,
    column: typeof raw.column === "number" ? raw.column : 0,
    symbol: typeof raw.symbol === "string" ? raw.symbol : "",
    newName: typeof raw.newName === "string" ? raw.newName : "",
  });
}

/**
 * Kinds persisted as "one primary string field plus one optional second string
 * field". Three near-identical branches for these was what pushed the main
 * coercer past its complexity ceiling, so they share a table instead. A null
 * `primary` means the kind has no required field at all (visualizer).
 */
const OPTIONAL_PAIR_FIELD_BY_KIND: Record<string, { primary: string | null; optional: string }> = {
  visualizer: { primary: null, optional: "runId" },
  orchestrationGraph: { primary: "graphId", optional: "runId" },
};

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Refine carries two path LISTS, so it does not fit the single-field table above. */
function coerceRefineTabTarget(raw: Record<string, unknown>): WorkspaceTabTarget | null {
  const references = toStringArray(raw.references);
  return normalizeWorkspaceTabTarget({
    kind: "refine",
    paths: toStringArray(raw.paths),
    ...(references.length > 0 ? { references } : {}),
    ...(typeof raw.presetId === "string" ? { presetId: raw.presetId } : {}),
  });
}

function coerceOptionalPairTabTarget(
  kind: string,
  raw: Record<string, unknown>,
): WorkspaceTabTarget | null {
  const spec = OPTIONAL_PAIR_FIELD_BY_KIND[kind];
  if (!spec) {
    return null;
  }
  const primary = spec.primary ? raw[spec.primary] : null;
  if (spec.primary && typeof primary !== "string") {
    return null;
  }
  const optional = raw[spec.optional];
  return normalizeWorkspaceTabTarget({
    kind,
    ...(spec.primary ? { [spec.primary]: primary } : {}),
    ...(typeof optional === "string" ? { [spec.optional]: optional } : {}),
  } as WorkspaceTabTarget);
}

function coerceWorkspaceTabTarget(raw: Record<string, unknown>): WorkspaceTabTarget | null {
  const kind = typeof raw.kind === "string" ? raw.kind : null;
  if (kind === "draft" && typeof raw.draftId === "string") {
    const setup = normalizeWorkspaceDraftTabSetup(raw.setup);
    return normalizeWorkspaceTabTarget({
      kind: "draft",
      draftId: raw.draftId,
      ...(setup ? { setup } : {}),
    });
  }
  if (kind === "file" || kind === "editor") {
    return coerceFileLikeTabTarget(raw);
  }
  if (kind && kind in OPTIONAL_PAIR_FIELD_BY_KIND) {
    return coerceOptionalPairTabTarget(kind, raw);
  }
  if (kind === "fileHistory") {
    return coerceFileHistoryTabTarget(raw);
  }
  if (kind === "codeReferences") {
    return coerceCodeReferencesTabTarget(raw);
  }
  if (kind === "codeRename") {
    return coerceCodeRenameTabTarget(raw);
  }
  if (kind === "refine") {
    return coerceRefineTabTarget(raw);
  }
  // No id field at all - the workspace is the identity.
  if (kind === "contextManagement") {
    return normalizeWorkspaceTabTarget({ kind: "contextManagement" });
  }
  const field = kind ? SIMPLE_STRING_FIELD_BY_KIND[kind] : undefined;
  if (kind && field && typeof raw[field] === "string") {
    return normalizeWorkspaceTabTarget({ kind, [field]: raw[field] } as WorkspaceTabTarget);
  }
  return null;
}

// COMPAT(unifiedFileTab): added 2026-07-09 - persisted "editor" tabs from
// before the editor/preview unification coerce to plain file tabs (the view
// mode now lives in the file-view store). Drop the "editor" acceptance once
// stored states predating it are gone (target: 2027-01).
function coerceFileLikeTabTarget(raw: Record<string, unknown>): WorkspaceTabTarget | null {
  if (typeof raw.path !== "string") {
    return null;
  }
  const origin = coerceWorkspaceFileOrigin(raw.origin);
  return normalizeWorkspaceTabTarget({
    kind: "file",
    path: raw.path,
    lineStart: typeof raw.lineStart === "number" ? raw.lineStart : undefined,
    lineEnd: typeof raw.lineEnd === "number" ? raw.lineEnd : undefined,
    ...(origin ? { origin } : {}),
  });
}

// Rebuilds a persisted out-of-project origin (gated-multi-root) from stored
// tab state. Only returns an origin when every required field is a non-empty
// string; otherwise the file falls back to an ordinary in-project tab.
function coerceWorkspaceFileOrigin(raw: unknown): WorkspaceFileOrigin | undefined {
  const record = toObjectRecord(raw);
  if (!record) {
    return undefined;
  }
  const workspaceId = trimNonEmpty(
    typeof record.workspaceId === "string" ? record.workspaceId : null,
  );
  const cwd = trimNonEmpty(typeof record.cwd === "string" ? record.cwd : null);
  const projectId = trimNonEmpty(typeof record.projectId === "string" ? record.projectId : null);
  if (!workspaceId || !cwd || !projectId) {
    return undefined;
  }
  const projectName = trimNonEmpty(
    typeof record.projectName === "string" ? record.projectName : null,
  );
  return {
    workspaceId,
    cwd,
    projectId,
    ...(projectName ? { projectName } : {}),
  };
}

function migrateSingleTab(rawTab: unknown, now: number): WorkspaceTab | null {
  const record = toObjectRecord(rawTab);
  if (!record) {
    return null;
  }
  const rawTarget = toObjectRecord(record.target);
  const normalizedTarget = rawTarget ? coerceWorkspaceTabTarget(rawTarget) : null;
  if (!normalizedTarget) {
    return null;
  }
  const rawTabId = trimNonEmpty(typeof record.tabId === "string" ? record.tabId : null);
  const tabId = rawTabId ?? buildDeterministicWorkspaceTabId(normalizedTarget);
  const rawCreatedAt = record.createdAt;
  return {
    tabId,
    target: normalizedTarget,
    createdAt: typeof rawCreatedAt === "number" ? rawCreatedAt : now,
  };
}

interface MigratedTabsForKey {
  nextUiTabs: WorkspaceTab[];
  orderFromTabs: string[];
}

function migrateUiTabsForKey(rawEntries: unknown, now: number): MigratedTabsForKey {
  const entries = Array.isArray(rawEntries) ? rawEntries : [];
  const nextUiTabs: WorkspaceTab[] = [];
  const orderFromTabs: string[] = [];
  const usedOrder = new Set<string>();

  for (const rawTab of entries) {
    const migrated = migrateSingleTab(rawTab, now);
    if (!migrated) {
      continue;
    }
    if (!usedOrder.has(migrated.tabId)) {
      usedOrder.add(migrated.tabId);
      orderFromTabs.push(migrated.tabId);
    }
    nextUiTabs.push(migrated);
  }

  return { nextUiTabs, orderFromTabs };
}

function mergeExplicitTabOrder(
  tabOrderByWorkspace: Record<string, string[]>,
  rawOrder: Record<string, unknown>,
): void {
  for (const key in rawOrder) {
    const normalizedOrder = normalizeTabOrder(rawOrder[key]);
    if (normalizedOrder.length === 0) {
      continue;
    }
    const existing = tabOrderByWorkspace[key] ?? [];
    tabOrderByWorkspace[key] = normalizeTabOrder([...existing, ...normalizedOrder]);
  }
}

function convertLegacyOrderEntry(entry: unknown): string | null {
  const raw = typeof entry === "string" ? entry.trim() : "";
  if (!raw) {
    return null;
  }
  if (raw.startsWith("agent:")) {
    const agentId = raw.slice("agent:".length).trim();
    return agentId ? `agent_${agentId}` : null;
  }
  if (raw.startsWith("terminal:")) {
    const terminalId = raw.slice("terminal:".length).trim();
    return terminalId ? `terminal_${terminalId}` : null;
  }
  return null;
}

function normalizeLegacyOrderList(list: unknown[]): string[] {
  const result: string[] = [];
  for (const entry of list) {
    const converted = convertLegacyOrderEntry(entry);
    if (converted) {
      result.push(converted);
    }
  }
  return result;
}

function mergeLegacyTabOrder(
  tabOrderByWorkspace: Record<string, string[]>,
  legacyOrder: Record<string, unknown>,
): void {
  for (const key in legacyOrder) {
    const list = legacyOrder[key];
    if (!Array.isArray(list) || list.length === 0) {
      continue;
    }
    const normalizedLegacyOrder = normalizeLegacyOrderList(list);
    if (normalizedLegacyOrder.length === 0) {
      continue;
    }
    const existing = tabOrderByWorkspace[key] ?? [];
    tabOrderByWorkspace[key] = normalizeTabOrder([...existing, ...normalizedLegacyOrder]);
  }
}

function resolveFocusedTabId(rawValue: unknown): string | null {
  if (typeof rawValue === "string") {
    return trimNonEmpty(rawValue);
  }
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }
  const value = rawValue as {
    kind?: string;
    agentId?: string;
    terminalId?: string;
    draftId?: string;
  };
  if (value.kind === "agent" && typeof value.agentId === "string" && value.agentId.trim()) {
    return `agent_${value.agentId.trim()}`;
  }
  if (
    value.kind === "terminal" &&
    typeof value.terminalId === "string" &&
    value.terminalId.trim()
  ) {
    return `terminal_${value.terminalId.trim()}`;
  }
  if (value.kind === "draft" && typeof value.draftId === "string" && value.draftId.trim()) {
    return value.draftId.trim();
  }
  return null;
}

function migrateFocusedTabIds(
  focusedTabIdByWorkspace: Record<string, string>,
  rawFocused: Record<string, unknown>,
): void {
  for (const key in rawFocused) {
    const resolved = resolveFocusedTabId(rawFocused[key]);
    if (resolved) {
      focusedTabIdByWorkspace[key] = resolved;
    }
  }
}

export function migrateWorkspaceTabsState(
  persistedState: unknown,
  options: { now: number },
): WorkspaceTabsCoreState {
  const { rawUiTabsByWorkspace, rawFocused, rawOrder, legacyOrder } =
    extractMigrationRawSources(persistedState);

  const uiTabsByWorkspace: Record<string, WorkspaceTab[]> = {};
  const tabOrderByWorkspace: Record<string, string[]> = {};
  const focusedTabIdByWorkspace: Record<string, string> = {};

  for (const key in rawUiTabsByWorkspace) {
    const { nextUiTabs, orderFromTabs } = migrateUiTabsForKey(
      rawUiTabsByWorkspace[key],
      options.now,
    );
    if (nextUiTabs.length > 0) {
      uiTabsByWorkspace[key] = nextUiTabs;
    }
    if (orderFromTabs.length > 0) {
      tabOrderByWorkspace[key] = orderFromTabs;
    }
  }

  mergeExplicitTabOrder(tabOrderByWorkspace, rawOrder);
  mergeLegacyTabOrder(tabOrderByWorkspace, legacyOrder);
  migrateFocusedTabIds(focusedTabIdByWorkspace, rawFocused);

  return {
    uiTabsByWorkspace,
    tabOrderByWorkspace,
    focusedTabIdByWorkspace,
  };
}

export function partializeWorkspaceTabsState(
  state: WorkspaceTabsCoreState,
  options: { now: number },
): WorkspaceTabsCoreState {
  const nextUiTabsByWorkspace: Record<string, WorkspaceTab[]> = {};
  for (const key in state.uiTabsByWorkspace) {
    const tabs = (state.uiTabsByWorkspace[key] ?? [])
      .map((tab) => {
        const normalizedTarget = normalizeWorkspaceTabTarget(tab.target);
        const normalizedTabId = trimNonEmpty(tab.tabId);
        if (!normalizedTarget || !normalizedTabId) {
          return null;
        }
        return {
          tabId: normalizedTabId,
          target: normalizedTarget,
          createdAt: typeof tab.createdAt === "number" ? tab.createdAt : options.now,
        } satisfies WorkspaceTab;
      })
      .filter((tab): tab is WorkspaceTab => tab !== null);
    if (tabs.length > 0) {
      nextUiTabsByWorkspace[key] = tabs;
    }
  }

  const nextTabOrderByWorkspace: Record<string, string[]> = {};
  for (const key in state.tabOrderByWorkspace) {
    const order = normalizeTabOrder(state.tabOrderByWorkspace[key]);
    if (order.length > 0) {
      nextTabOrderByWorkspace[key] = order;
    }
  }

  const nextFocusedTabIdByWorkspace: Record<string, string> = {};
  for (const key in state.focusedTabIdByWorkspace) {
    const focusedTabId = trimNonEmpty(state.focusedTabIdByWorkspace[key]);
    if (focusedTabId) {
      nextFocusedTabIdByWorkspace[key] = focusedTabId;
    }
  }

  return {
    uiTabsByWorkspace: nextUiTabsByWorkspace,
    tabOrderByWorkspace: nextTabOrderByWorkspace,
    focusedTabIdByWorkspace: nextFocusedTabIdByWorkspace,
  };
}
