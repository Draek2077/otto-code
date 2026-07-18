// Pure Otto -> SimulationEvent mapping. No I/O, no store/client access — the
// stateful side (name registry, backfill fetch, live-stream cursor dedup)
// lives in use-visualizer-event-adapter.ts, which calls into these functions.
// See docs/visualizer.md for the mapping table this file implements.
import type { AgentLifecycleStatus } from "@otto-code/protocol/agent-lifecycle";
import { deriveObservedSubagentTitle } from "@otto-code/protocol/observed-subagent-title";
import { getToolDisplayName } from "@otto-code/protocol/tool-call-display";
import type {
  AgentTimelineItem,
  AgentUsage,
  ContextComposition,
  ToolCallDetail,
  ToolCallTimelineItem,
} from "@otto-code/protocol/agent-types";
import type { AgentStreamEventPayload } from "@otto-code/protocol/messages";
import type { SimulationEvent } from "@/visualizer/visualizer-view-types";

export type VisualizerRuntime =
  | "claude"
  | "codex"
  | "copilot"
  | "opencode"
  | "pi"
  | "openai-compat";

/** `runtime` only picks the node logo; unmapped providers (e.g. a
 * user-defined custom openai-compatible provider with an arbitrary id) omit
 * the field so the page falls back to its default (claude) logo — matching
 * vendor/agent-flow/OTTO-PATCHES.md's "generic diamond mark" patch, which
 * only fires for these known literals. "omp" is Otto's builtin id for the
 * bundled openai-compatible provider (Oh My Pi) — see
 * packages/protocol/src/provider-manifest.ts. */
export function resolveVisualizerRuntime(provider: string): VisualizerRuntime | undefined {
  if (provider === "claude") {
    return "claude";
  }
  if (provider.startsWith("codex")) {
    return "codex";
  }
  if (provider === "copilot" || provider === "opencode" || provider === "pi") {
    return provider;
  }
  if (provider === "omp") {
    return "openai-compat";
  }
  return undefined;
}

const MAX_SUMMARY_LENGTH = 200;

function truncate(text: string, max: number = MAX_SUMMARY_LENGTH): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Session tab labels render in a cramped horizontal strip at the page's
 * top-left (vendor session-tabs.tsx pins each tab `whiteSpace: nowrap` +
 * `flexShrink: 0` with no max-width/ellipsis), so a long agent title blows the
 * tab out and crowds the others off. Cap the *label* host-side — the node
 * `name` (graph key, must stay unique/stable) is deliberately left full. */
const MAX_SESSION_LABEL_LENGTH = 24;

export function truncateSessionLabel(label: string): string {
  const trimmed = label.trim();
  return trimmed.length > MAX_SESSION_LABEL_LENGTH
    ? `${trimmed.slice(0, MAX_SESSION_LABEL_LENGTH).trimEnd()}…`
    : trimmed;
}

/** Node names must be stable and unique per session (the page keys agents by
 * `name`). `usedNames` is the set already assigned within the same
 * SimulationEvent sessionId; on collision a short id suffix disambiguates. */
export function resolveAgentNodeName(input: {
  agentId: string;
  title: string | null;
  usedNames: ReadonlySet<string>;
}): string {
  const trimmedTitle = input.title?.trim();
  const candidate =
    trimmedTitle && trimmedTitle.length > 0 ? trimmedTitle : `Agent ${input.agentId.slice(0, 6)}`;
  if (!input.usedNames.has(candidate)) {
    return candidate;
  }
  return `${candidate} (${input.agentId.slice(0, 6)})`;
}

/** Shared identity a mapping call needs: the resolved node name and the
 * SimulationEvent sessionId (the root agent's own id) this node belongs to. */
export interface AgentNodeContext {
  name: string;
  sessionId: string;
  /** The agent's own working directory (root of its file operations). When
   * present, tool-call file paths are displayed relative to it (root → `.`) —
   * a Read of `C:\Users\me\proj\src\foo.ts` shows as `src\foo.ts` (Windows
   * separators preserved) instead of a truncated `C:\Users\me\pr...`. Absent ⇒
   * paths are shown verbatim. See `relativizeStringPaths`. */
  workspaceRoot?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rewrites the workspace root wherever it literally appears in a string — a
 * structured file path (`detail.filePath`) OR a freeform command/search string —
 * to a workspace-relative form, so a tool node reads `cd "."` /
 * `read_file: src\foo.ts` instead of `cd "C:/…/proj"` /
 * `read_file: C:\…\proj\src\foo.ts`. A child path drops the root entirely
 * (`…\proj\src\foo.ts` → `src\foo.ts`); a bare root collapses to `.`.
 *
 * SEPARATOR FIDELITY (load-bearing): the match is separator-agnostic but the
 * output preserves whatever separators the path was AUTHORED with — a Windows
 * `C:\…\proj\src\foo.ts` becomes `src\foo.ts` (backslashes kept), a POSIX
 * `/home/me/proj/src/foo.ts` becomes `src/foo.ts`. We deliberately do NOT run
 * paths through `resolveWorkspaceFilePaths`/`normalizeWorkspaceFileLocation`
 * here: those normalize `\` → `/` for host resolution, which is correct for
 * OPENING a file but wrong for DISPLAY — it mixed backslash (out-of-workspace,
 * shown verbatim) and forward-slash (relativized) rows in the same panel.
 * Windows paths stay Windows; POSIX paths stay POSIX. Only the root prefix (plus
 * its trailing separator, for a child path) is removed; separators in the
 * remainder are left exactly as-is.
 *
 * Other rules (root → `.`, root+`sep`+rest → `rest`):
 * - Matches the root in EITHER separator style, case-insensitively for a
 *   Windows drive path (the reported path and the `cwd` can disagree on case).
 * - Requires a path BOUNDARY right after the root — a separator, a delimiter
 *   like a quote/space/paren, or end-of-string — so the bare/quoted root
 *   collapses AND a sibling dir that merely shares the prefix (`…/proj-backup`,
 *   `…/project`) is never touched.
 * - Never tries to *detect* arbitrary paths, so it can't mangle non-path prose —
 *   a full absolute root is effectively never a false-positive substring. Files
 *   outside the workspace have no matching prefix and are left verbatim.
 */
function relativizeStringPaths(text: string, workspaceRoot: string | undefined): string {
  if (!workspaceRoot || !text) {
    return text;
  }
  const root = workspaceRoot.trim().replace(/[\\/]+$/, "");
  if (!root) {
    return text;
  }
  const isWindows = /^[A-Za-z]:/.test(root);
  // Split on separators and rejoin the escaped segments with a separator class,
  // so `C:\Users\me\proj` matches both `C:\Users\me\proj…` and `C:/Users/me/proj…`.
  const rootPattern = root
    .split(/[\\/]+/)
    .map(escapeRegExp)
    .join("[\\\\/]");
  // Consume the root and, when a child follows, its leading separator too — so
  // `C:\…\proj\src\foo.ts` collapses straight to `src\foo.ts` rather than the
  // noisier `.\src\foo.ts`. Two boundary cases, in one pass:
  //   - root followed by a separator → capture the separator and drop it with the
  //     root (remainder is left verbatim, keeping its authored separators).
  //   - bare root, at end-of-string or before a non-path delimiter (quote/space/
  //     paren) → lookahead only, and the root collapses to `.` (`cd "."`).
  const pattern = new RegExp(`${rootPattern}(?:([\\\\/])|(?=[^\\w.-]|$))`, isWindows ? "gi" : "g");
  return text.replace(pattern, (_match, sep: string | undefined) => (sep ? "" : "."));
}

/** The two identity colors of an Agent Personality (the daemon's spinner
 * glowA/glowB pair, carried on the agent snapshot as `personalitySpinner`). */
export interface PersonalityNodeColors {
  glowA: string;
  glowB: string;
}

/** Spawn-payload leaf for a personality's colors. The vendor page tints a
 * node's idle (muted) / thinking (vivid) states in these when both are present
 * (see vendor draw-agents.ts `resolveNodeAppearance`); a node with no
 * personality omits them and stays state-colored. Both must be present to
 * count — a partial pair is dropped. */
function personaColorPayload(colors: PersonalityNodeColors | null | undefined):
  | {
      colorA: string;
      colorB: string;
    }
  | Record<string, never> {
  if (colors?.glowA && colors.glowB) {
    return { colorA: colors.glowA, colorB: colors.glowB };
  }
  return {};
}

export function buildRootAgentSpawnEvent(input: {
  ctx: AgentNodeContext;
  model: string | null;
  provider: string;
  personalityColors?: PersonalityNodeColors | null;
  time: number;
}): SimulationEvent {
  const runtime = resolveVisualizerRuntime(input.provider);
  return {
    time: input.time,
    sessionId: input.ctx.sessionId,
    type: "agent_spawn",
    payload: {
      name: input.ctx.name,
      isMain: true,
      ...(input.model ? { model: input.model } : {}),
      ...(runtime ? { runtime } : {}),
      ...personaColorPayload(input.personalityColors),
    },
  };
}

export function buildObservedSubagentSpawnEvent(input: {
  ctx: AgentNodeContext;
  parentName: string;
  task?: string | null;
  personalityColors?: PersonalityNodeColors | null;
  time: number;
}): SimulationEvent {
  return {
    time: input.time,
    sessionId: input.ctx.sessionId,
    type: "agent_spawn",
    payload: {
      name: input.ctx.name,
      parent: input.parentName,
      ...(input.task ? { task: input.task } : {}),
      ...personaColorPayload(input.personalityColors),
    },
  };
}

/** Relabel an already-spawned node's DISPLAY name (the vendor page keeps the
 * node keyed on its original spawn `name`, so this only changes the drawn
 * label — see the `agent_rename` handler in handle-agent-events.ts). Emitted
 * when a root chat's title changes after spawn (the auto-title writer rewrites
 * the provisional first-line title), so the graph node tracks the chat title
 * the same way the toolbar's `session-updated` label does. `agent` is the
 * stable node key (the frozen spawn name); `label` is the new full title. */
export function buildAgentRenameEvent(input: {
  ctx: AgentNodeContext;
  label: string;
  time: number;
}): SimulationEvent {
  return {
    time: input.time,
    sessionId: input.ctx.sessionId,
    type: "agent_rename",
    payload: { agent: input.ctx.name, label: input.label },
  };
}

export function buildModelDetectedEvent(input: {
  ctx: AgentNodeContext;
  model: string;
  time: number;
}): SimulationEvent {
  return {
    time: input.time,
    sessionId: input.ctx.sessionId,
    type: "model_detected",
    payload: { agent: input.ctx.name, model: input.model },
  };
}

/** What the visualizer needs to decide whether an agent's node is finished
 * and should emit `agent_complete` (fade out of the graph). */
export interface VisualizerTerminalInput {
  status: AgentLifecycleStatus;
  attend: "attended" | "observed" | undefined;
  archived: boolean;
  requiresAttention: boolean;
}

/** True when a node should complete and fade out. Mirrors the subagents
 * track's tidy-eligibility (`isSubagentRowTidyEligible` in
 * subagents/track-presentation.ts) so a subagent leaves the graph at exactly
 * the moment the track collapses it into its "Completed" group:
 *
 * - `closed` or archived is always terminal (roots included — a session that
 *   ends stops rendering as active).
 * - A provider-managed (`observed`) subagent is also done at `idle` or `error`:
 *   a Claude Task ends its run at `idle` and never resumes, so idle-observed is
 *   genuinely finished, whereas a native subagent idles *between turns* and may
 *   still be mid-conversation — so only `observed` idle counts. Attention rows
 *   (e.g. a usage-exhausted failure) stay visible so the signal isn't buried.
 *
 * Without this an idle Claude Task node lingered forever, because the old test
 * was `status === "closed" || archived` only — an observed subagent that
 * completes to `idle` matched neither and never faded. */
export function isVisualizerAgentTerminal(input: VisualizerTerminalInput): boolean {
  if (input.status === "closed" || input.archived) {
    return true;
  }
  if (input.attend === "observed" && !input.requiresAttention) {
    return input.status === "idle" || input.status === "error";
  }
  return false;
}

export function buildAgentCompleteEvent(input: {
  ctx: AgentNodeContext;
  time: number;
}): SimulationEvent {
  return {
    time: input.time,
    sessionId: input.ctx.sessionId,
    type: "agent_complete",
    payload: { name: input.ctx.name },
  };
}

export function buildAgentIdleEvent(input: {
  ctx: AgentNodeContext;
  time: number;
  /** True marks a real turn end — the page rests the node at its dim 'idle'
   * state (Otto vendor patch) instead of the upstream "back to thinking"
   * transition, so an idle agent no longer looks identical to one reasoning. */
  resting?: boolean;
}): SimulationEvent {
  return {
    time: input.time,
    sessionId: input.ctx.sessionId,
    type: "agent_idle",
    payload: { name: input.ctx.name, ...(input.resting ? { resting: true } : {}) },
  };
}

export function buildPermissionRequestedEvent(input: {
  ctx: AgentNodeContext;
  time: number;
}): SimulationEvent {
  return {
    time: input.time,
    sessionId: input.ctx.sessionId,
    type: "permission_requested",
    payload: { agent: input.ctx.name },
  };
}

/** The vendor page's 5-category context breakdown (`ContextBreakdown`). All
 * five keys must be present as numbers — the page only accepts a breakdown
 * whose object literally carries `systemPrompt` (`'systemPrompt' in raw`). */
interface VisualizerContextBreakdown {
  systemPrompt: number;
  userMessages: number;
  toolResults: number;
  reasoning: number;
  subagentResults: number;
}

/** Turn the daemon's estimated {@link ContextComposition} into the page
 * breakdown, scaled so the segments sum to the authoritative occupancy — the
 * ring draws each arc as `value / tokensMax` and the bar as `value / tokensUsed`,
 * so the proportions must total the real fill. Missing categories default to 0
 * (Otto doesn't track `systemPrompt`, so it's typically 0). Returns null when
 * the composition is empty (nothing to color). */
function buildContextBreakdown(
  composition: ContextComposition,
  occupancyTokens: number | undefined,
): VisualizerContextBreakdown | null {
  const raw: VisualizerContextBreakdown = {
    systemPrompt: composition.systemPrompt ?? 0,
    userMessages: composition.userMessages ?? 0,
    toolResults: composition.toolResults ?? 0,
    reasoning: composition.reasoning ?? 0,
    subagentResults: composition.subagentResults ?? 0,
  };
  const sum =
    raw.systemPrompt + raw.userMessages + raw.toolResults + raw.reasoning + raw.subagentResults;
  if (sum <= 0) return null;
  if (occupancyTokens == null || occupancyTokens <= 0) return raw;
  const scale = occupancyTokens / sum;
  return {
    systemPrompt: Math.round(raw.systemPrompt * scale),
    userMessages: Math.round(raw.userMessages * scale),
    toolResults: Math.round(raw.toolResults * scale),
    reasoning: Math.round(raw.reasoning * scale),
    subagentResults: Math.round(raw.subagentResults * scale),
  };
}

/** `tokens`/`tokensMax` are context OCCUPANCY (drives the ring/bar fill);
 * `cumulativeTokens` is the agent's honest lifetime total (drives the page's
 * token/cost sums — Otto vendor patch); `breakdown` is the daemon's estimated
 * context composition (drives the colored ring/bar segments — absent when the
 * provider couldn't attribute anything, so the page shows occupancy only).
 * Returns null when no reading is present (nothing worth emitting). */
export function buildContextUpdateEvent(input: {
  ctx: AgentNodeContext;
  usage?: AgentUsage;
  cumulativeTokens?: number;
  time: number;
}): SimulationEvent | null {
  const contextTokens = input.usage?.contextWindowUsedTokens;
  if (contextTokens == null && input.cumulativeTokens == null) {
    return null;
  }
  const breakdown = input.usage?.contextComposition
    ? buildContextBreakdown(input.usage.contextComposition, contextTokens ?? undefined)
    : null;
  return {
    time: input.time,
    sessionId: input.ctx.sessionId,
    type: "context_update",
    payload: {
      agent: input.ctx.name,
      ...(contextTokens != null ? { tokens: contextTokens } : {}),
      ...(input.usage?.contextWindowMaxTokens != null
        ? { tokensMax: input.usage.contextWindowMaxTokens }
        : {}),
      ...(input.cumulativeTokens != null ? { cumulativeTokens: input.cumulativeTokens } : {}),
      ...(breakdown ? { breakdown } : {}),
    },
  };
}

export function toolCallDetailFilePath(detail: ToolCallDetail): string | undefined {
  switch (detail.type) {
    case "read":
    case "edit":
    case "write":
      return detail.filePath;
    default:
      return undefined;
  }
}

/** Short args summary shown on the tool-call node while it's running. */
export function summarizeToolCallArgs(detail: ToolCallDetail): string {
  switch (detail.type) {
    case "shell":
      return detail.command;
    case "read":
    case "edit":
    case "write":
      return detail.filePath;
    case "search":
      return detail.query;
    case "fetch":
      return detail.url;
    case "worktree_setup":
      return detail.branchName;
    case "sub_agent":
      return detail.description ?? detail.subAgentType ?? "";
    case "plain_text":
      return detail.label ?? detail.text ?? "";
    case "plan":
      return truncate(detail.text);
    case "unknown":
      return "";
    default:
      return "";
  }
}

function summarizeShellResult(detail: Extract<ToolCallDetail, { type: "shell" }>): string {
  if (detail.output) {
    return truncate(detail.output);
  }
  return detail.exitCode != null ? `exit ${detail.exitCode}` : "";
}

function summarizeSearchResult(detail: Extract<ToolCallDetail, { type: "search" }>): string {
  if (detail.numMatches != null) {
    return `${detail.numMatches} matches`;
  }
  if (detail.numFiles != null) {
    return `${detail.numFiles} files`;
  }
  return detail.content ? truncate(detail.content) : "";
}

/** Short result summary shown once the tool call finishes. */
export function summarizeToolCallResult(detail: ToolCallDetail): string {
  switch (detail.type) {
    case "shell":
      return summarizeShellResult(detail);
    case "read":
      return detail.content ? truncate(detail.content) : "";
    case "edit":
      return detail.unifiedDiff ? truncate(detail.unifiedDiff) : "";
    case "write":
      return detail.content ? truncate(detail.content) : "";
    case "search":
      return summarizeSearchResult(detail);
    case "fetch":
      return detail.result ? truncate(detail.result) : (detail.codeText ?? "");
    case "worktree_setup":
      return truncate(detail.log);
    case "sub_agent":
      return truncate(detail.log);
    case "plain_text":
      return detail.text ?? detail.label ?? "";
    case "plan":
      return truncate(detail.text);
    case "unknown":
      return "";
    default:
      return "";
  }
}

/** A notable finding surfaced from a completed tool call, rendered as a floating
 * discovery card near the node (vendor `Discovery`; the page consumes this via
 * the OTTO-PATCHES "discovery cards" wire on `tool_call_end`). */
export interface DerivedDiscovery {
  type: "file" | "pattern" | "finding" | "code";
  label: string;
  content: string;
}

const DISCOVERY_LABEL_MAX = 40;
const DISCOVERY_LINE_MAX = 44;

function discoveryLine(text: string, max = DISCOVERY_LINE_MAX): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}

/** First non-empty content lines, each length-clamped, at most `count`. */
function firstContentLines(content: string, count: number): string[] {
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, count)
    .map((l) => discoveryLine(l));
}

/** Count added/removed lines in a unified diff (ignoring the +++/--- headers). */
function summarizeUnifiedDiff(diff: string): string {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  if (added === 0 && removed === 0) return "edited";
  return `+${added} −${removed} lines`;
}

const TEST_RESULT_RE =
  /(\d+\s+(?:passed|failed|passing|failing))|(tests?:)|(\bpass(?:ed)?\b|\bfail(?:ed)?\b)|coverage|(\d+\s+of\s+\d+)/i;

/** Pull the most informative test/coverage lines out of shell output. */
function summarizeTestOutput(output: string): { label: string; content: string } | null {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const hits = lines.filter((l) => TEST_RESULT_RE.test(l)).slice(0, 3);
  if (hits.length === 0) return null;
  const failed = /fail/i.test(output) && !/0\s+fail/i.test(output);
  const label = failed ? "Tests failed" : "Tests pass";
  return { label, content: hits.map((l) => discoveryLine(l)).join("\n") };
}

type RelFn = (p: string) => string;

function searchDiscovery(
  detail: Extract<ToolCallDetail, { type: "search" }>,
  rel: RelFn,
): DerivedDiscovery | null {
  // Web search → the top result titles are the finding.
  if (detail.webResults && detail.webResults.length > 0) {
    return {
      type: "finding",
      label: discoveryLine(detail.query || "Web search", DISCOVERY_LABEL_MAX),
      content: detail.webResults
        .slice(0, 3)
        .map((r) => discoveryLine(r.title))
        .join("\n"),
    };
  }
  // Grep/Glob → match/file counts + a few paths.
  if (detail.numMatches == null && detail.numFiles == null) return null;
  const counts: string[] = [];
  if (detail.numMatches != null)
    counts.push(`${detail.numMatches} match${detail.numMatches === 1 ? "" : "es"}`);
  if (detail.numFiles != null)
    counts.push(`${detail.numFiles} file${detail.numFiles === 1 ? "" : "s"}`);
  const paths = (detail.filePaths ?? []).slice(0, 3).map((p) => discoveryLine(rel(p)));
  return {
    type: "pattern",
    label: discoveryLine(detail.query || "Search", DISCOVERY_LABEL_MAX),
    content: [counts.join(" · "), ...paths].filter(Boolean).join("\n"),
  };
}

function writeDiscovery(
  detail: Extract<ToolCallDetail, { type: "write" }>,
  rel: RelFn,
): DerivedDiscovery {
  const lineCount = detail.content ? detail.content.split("\n").length : 0;
  const peek = detail.content ? firstContentLines(detail.content, 2) : [];
  return {
    type: "code",
    label: `NEW: ${discoveryLine(rel(detail.filePath), DISCOVERY_LABEL_MAX)}`,
    content: [lineCount > 0 ? `${lineCount} lines` : "created", ...peek].filter(Boolean).join("\n"),
  };
}

function shellDiscovery(
  detail: Extract<ToolCallDetail, { type: "shell" }>,
  isError: boolean | undefined,
): DerivedDiscovery | null {
  const test = detail.output ? summarizeTestOutput(detail.output) : null;
  if (test) return { type: "finding", label: test.label, content: test.content };
  // A failed command is a finding even when it's not a test run.
  if (!isError && !(detail.exitCode != null && detail.exitCode !== 0)) return null;
  return {
    type: "finding",
    label: "Command failed",
    content: [
      discoveryLine(detail.command, DISCOVERY_LABEL_MAX),
      detail.exitCode != null ? `exit ${detail.exitCode}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function fetchDiscovery(
  detail: Extract<ToolCallDetail, { type: "fetch" }>,
): DerivedDiscovery | null {
  if (!detail.result) return null;
  let host = detail.url;
  try {
    host = new URL(detail.url).host || detail.url;
  } catch {
    // keep the raw url
  }
  return {
    type: "finding",
    label: discoveryLine(host, DISCOVERY_LABEL_MAX),
    content: firstContentLines(detail.result, 2).join("\n") || "fetched",
  };
}

/** Heuristic: turn a *notable* completed tool call into a discovery card, or
 * null for the ordinary majority. Deliberately excludes Read (the most frequent
 * tool — reads would spray low-value cards) and anything already represented as
 * its own node (sub_agent → subagent_return particle). Locked to "heuristic on
 * notable results" (projects/visualizer-node-richness). Pure over `detail`;
 * paths are relativized to the agent cwd, matching the rest of the graph. */
export function deriveToolCallDiscovery(
  detail: ToolCallDetail,
  opts?: { workspaceRoot?: string; isError?: boolean },
): DerivedDiscovery | null {
  const rel: RelFn = (p) => relativizeStringPaths(p, opts?.workspaceRoot);
  switch (detail.type) {
    case "search":
      return searchDiscovery(detail, rel);
    case "write":
      return writeDiscovery(detail, rel);
    case "edit":
      return {
        type: "code",
        label: discoveryLine(rel(detail.filePath), DISCOVERY_LABEL_MAX),
        content: detail.unifiedDiff ? summarizeUnifiedDiff(detail.unifiedDiff) : "edited",
      };
    case "shell":
      return shellDiscovery(detail, opts?.isError);
    case "fetch":
      return fetchDiscovery(detail);
    // Read (too frequent), sub_agent (own node), plan/plain_text/worktree/unknown.
    default:
      return null;
  }
}

/** Estimated tokens a finished tool call consumed, at ~4 chars/token over the
 * serialized detail payload — the same heuristic as turn-time.ts. Otto's
 * protocol carries no per-tool usage (providers only report it at request
 * boundaries), so this estimate is what feeds the page's `tokenCost` (the
 * "N tok" line on completed cards, file-attention totals). The page's context
 * ring self-corrects: every `context_update` sets occupancy absolutely. */
export function estimateToolCallTokenCost(detail: ToolCallDetail): number | undefined {
  let chars = 0;
  try {
    chars = JSON.stringify(detail)?.length ?? 0;
  } catch {
    return undefined;
  }
  const tokens = Math.round(chars / 4);
  return tokens > 0 ? tokens : undefined;
}

function stringifyToolCallError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Child label for subagent_dispatch/subagent_return. MUST resolve to the same
 * string as the observed child agent's node name (which is the daemon-frozen
 * row title) — the page renders dispatch/return particles on the parent→child
 * edge keyed by that name, so any mismatch makes them silently invisible.
 * Both sides therefore share `deriveObservedSubagentTitle`. Exported so the
 * stateful layer can re-dispatch when a running item's streaming input
 * changes the derived label (e.g. `subagent_type` parses after `description`).
 */
export function resolveSubAgentChildLabel(
  detail: Extract<ToolCallDetail, { type: "sub_agent" }>,
): string {
  return deriveObservedSubagentTitle({
    ...(detail.subAgentType ? { subAgentType: detail.subAgentType } : {}),
    ...(detail.description ? { description: detail.description } : {}),
  });
}

function toolCallSubAgentLabel(detail: Extract<ToolCallDetail, { type: "sub_agent" }>): string {
  return resolveSubAgentChildLabel(detail);
}

/** A dispatch spark alone — for a long-running sub_agent call whose first
 * running item predated the sub_agent detail (or whose start was already
 * emitted); the stateful layer dedupes per callId. */
export function buildSubagentDispatchEvent(input: {
  ctx: AgentNodeContext;
  detail: Extract<ToolCallDetail, { type: "sub_agent" }>;
  time: number;
}): SimulationEvent {
  const label = toolCallSubAgentLabel(input.detail);
  return {
    time: input.time,
    sessionId: input.ctx.sessionId,
    type: "subagent_dispatch",
    payload: { parent: input.ctx.name, child: label, task: label },
  };
}

/** The `tool_call_start` (+ `subagent_dispatch` for sub_agent calls) a
 * running item produces. Status-independent on purpose: also used to
 * synthesize the start for a terminal item whose running snapshot never
 * reached the client (the daemon's stream coalescer collapses running ->
 * terminal within its flush window into a single terminal item, live AND
 * persisted — the page drops a `tool_call_end` with no running match). */
function toolCallStartEvents(input: {
  ctx: AgentNodeContext;
  item: ToolCallTimelineItem;
  time: number;
}): SimulationEvent[] {
  const { ctx, item, time } = input;
  const rawFilePath = toolCallDetailFilePath(item.detail);
  const filePath = rawFilePath ? relativizeStringPaths(rawFilePath, ctx.workspaceRoot) : undefined;
  // For a file tool (read/edit/write) the args summary IS the file path, so
  // reuse the same workspace-relative form. Other tools carry a freeform summary
  // (shell command, search query) that may EMBED an absolute path — the same
  // rewrite handles both. Separators are preserved either way.
  const args =
    filePath ?? relativizeStringPaths(summarizeToolCallArgs(item.detail), ctx.workspaceRoot);
  const events: SimulationEvent[] = [
    {
      time,
      sessionId: ctx.sessionId,
      type: "tool_call_start",
      payload: {
        agent: ctx.name,
        // Friendly, namespace-stripped label ("mcp__otto__spawn_task" ->
        // "Spawn Task") — shared with the chat rows so nodes read the same way.
        tool: getToolDisplayName(item.name),
        args,
        ...(filePath ? { inputData: { file_path: filePath } } : {}),
      },
    },
  ];
  if (item.detail.type === "sub_agent") {
    const label = toolCallSubAgentLabel(item.detail);
    events.push({
      time,
      sessionId: ctx.sessionId,
      type: "subagent_dispatch",
      payload: { parent: ctx.name, child: label, task: label },
    });
  }
  return events;
}

function toolCallToSimulationEvents(input: {
  ctx: AgentNodeContext;
  item: ToolCallTimelineItem;
  time: number;
  synthesizeStart?: boolean;
}): SimulationEvent[] {
  const { ctx, item, time } = input;
  const subAgentDetail = item.detail.type === "sub_agent" ? item.detail : null;

  if (item.status === "running") {
    return toolCallStartEvents({ ctx, item, time });
  }

  const events: SimulationEvent[] = input.synthesizeStart
    ? toolCallStartEvents({ ctx, item, time })
    : [];
  const isError = item.status === "failed";
  const tokenCost = estimateToolCallTokenCost(item.detail);
  // Notable outcomes surface as a floating discovery card (page-side vendor
  // wire consumes payload.discovery). Null for the ordinary majority.
  const discovery = deriveToolCallDiscovery(item.detail, {
    workspaceRoot: ctx.workspaceRoot,
    isError,
  });
  events.push({
    time,
    sessionId: ctx.sessionId,
    type: "tool_call_end",
    payload: {
      agent: ctx.name,
      // Friendly, namespace-stripped label ("mcp__otto__spawn_task" ->
      // "Spawn Task") — shared with the chat rows so nodes read the same way.
      tool: getToolDisplayName(item.name),
      result: summarizeToolCallResult(item.detail),
      isError,
      ...(tokenCost != null ? { tokenCost } : {}),
      ...(discovery ? { discovery } : {}),
      ...(isError ? { errorMessage: stringifyToolCallError(item.error) } : {}),
    },
  });
  if (subAgentDetail) {
    const label = toolCallSubAgentLabel(subAgentDetail);
    events.push({
      time,
      sessionId: ctx.sessionId,
      type: "subagent_return",
      payload: { parent: ctx.name, child: label, summary: summarizeToolCallResult(item.detail) },
    });
  }
  return events;
}

/** Pure mapping of one canonical Otto timeline item to zero or more
 * SimulationEvents. Used both for timeline backfill (task 03 §Backfill) and
 * for live `agent_stream {type:"timeline"}` events (which carry the same
 * item shape). `todo`/`error`/`compaction` timeline items have no
 * SimulationEvent equivalent and are dropped. */
export function timelineItemToSimulationEvents(input: {
  ctx: AgentNodeContext;
  item: AgentTimelineItem;
  time: number;
  /** Prepend the tool_call_start (+ subagent_dispatch) a terminal tool_call
   * item would have been preceded by. Set by the stateful layer when it has
   * never seen a running item for this callId — see the coalescer note on
   * {@link toolCallStartEvents}. No effect on non-tool_call items. */
  synthesizeToolCallStart?: boolean;
}): SimulationEvent[] {
  const { ctx, item, time } = input;
  switch (item.type) {
    case "user_message":
      return [
        {
          time,
          sessionId: ctx.sessionId,
          type: "message",
          payload: { agent: ctx.name, content: item.text, role: "user" },
        },
      ];
    case "assistant_message":
      return [
        {
          time,
          sessionId: ctx.sessionId,
          type: "message",
          payload: { agent: ctx.name, content: item.text, role: "assistant" },
        },
      ];
    case "reasoning":
      return [
        {
          time,
          sessionId: ctx.sessionId,
          type: "message",
          payload: { agent: ctx.name, content: item.text, role: "thinking" },
        },
      ];
    case "tool_call":
      return toolCallToSimulationEvents({
        ctx,
        item,
        time,
        synthesizeStart: input.synthesizeToolCallStart,
      });
    case "todo":
    case "error":
    case "compaction":
      return [];
    default:
      return [];
  }
}

/** Pure mapping of one live `agent_stream` event to zero or more
 * SimulationEvents. `timeline` events delegate to
 * {@link timelineItemToSimulationEvents}. */
export function streamEventToSimulationEvents(input: {
  ctx: AgentNodeContext;
  event: AgentStreamEventPayload;
  time: number;
}): SimulationEvent[] {
  const { ctx, event, time } = input;
  switch (event.type) {
    case "timeline":
      return timelineItemToSimulationEvents({ ctx, item: event.item, time });
    case "turn_completed": {
      const events: SimulationEvent[] = [];
      const contextEvent = event.usage
        ? buildContextUpdateEvent({ ctx, usage: event.usage, time })
        : null;
      if (contextEvent) {
        events.push(contextEvent);
      }
      events.push(buildAgentIdleEvent({ ctx, time, resting: true }));
      return events;
    }
    case "turn_failed":
    case "turn_canceled":
      return [buildAgentIdleEvent({ ctx, time, resting: true })];
    case "permission_requested":
      return [buildPermissionRequestedEvent({ ctx, time })];
    case "permission_resolved":
      // The agent resumes its turn — back to reasoning, not resting.
      return [buildAgentIdleEvent({ ctx, time })];
    case "thread_started":
    case "turn_started":
    case "attention_required":
      return [];
    default:
      return [];
  }
}
