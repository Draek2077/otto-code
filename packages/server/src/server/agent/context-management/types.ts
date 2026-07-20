/**
 * Domain types for Context Management — the daemon's model of everything a
 * provider sends before the user types a word.
 *
 * See `projects/context-management/context-management.md` §2 and §5. The two
 * ideas that make or break every number downstream:
 *
 * 1. **Edge kind.** `@path` imports are inlined into the request; markdown
 *    links are not. Conflating them overstates this repo's own context by ~50x.
 * 2. **Cost class.** Fixed weight rides every request; conditional weight loads
 *    only when the agent touches that area; referenced weight loads only if the
 *    model chooses to read it.
 */

/** Where a node sits in the provider's load hierarchy — drives the UI scope badge. */
export type ContextScope =
  | "enterprise"
  | "global"
  | "project"
  | "local"
  | "subdirectory"
  /** Not a file on the load path: MCP schemas, Otto's own injections, etc. */
  | "runtime";

/**
 * The category buckets the report rolls up to. The tree root is "everything
 * sent before you type"; these are its children.
 */
export type ContextCategory =
  | "context_files"
  | "memory_index"
  | "skills_roster"
  | "mcp_tools"
  | "otto_injected"
  | "system_prompt";

/**
 * When the content reaches the model.
 * - `fixed`: every request, from turn one.
 * - `conditional`: only once the agent touches that area (subdirectory
 *   CLAUDE.md, skill bodies, recalled memory entries).
 * - `referenced`: only if the model decides to follow the link. Never counted
 *   as cost — surfaced so users can see the pull they've set up.
 */
export type ContextCostClass = "fixed" | "conditional" | "referenced";

export type ContextSeverity = "ok" | "notice" | "warn" | "critical";

/**
 * How much we trust the resolution.
 * - `exact`: Otto built the payload (openai-compat, Otto's own injections).
 * - `convention`: resolved from the provider's documented conventions.
 * - `unverified`: the provider is a subprocess we cannot see into; shown with
 *   an explicit caveat and never presented as fact.
 */
export type ContextConfidence = "exact" | "convention" | "unverified";

/** Deterministic, no-AI issues found during the scan (charter §7.5). */
export type ContextFindingKind =
  | "dead_import"
  | "dead_reference"
  | "duplicate_across_scope"
  | "duplicate_within_file"
  | "oversized_memory_entry"
  | "import_cycle"
  | "depth_capped";

export interface ContextFinding {
  kind: ContextFindingKind;
  /** One-line, user-facing, already resolved to concrete names. */
  message: string;
  /** Byte range in the owning node's file, when the finding points at a span. */
  range?: ContextRange;
  /** Other node ids implicated (the duplicate's twin, the cycle's members). */
  relatedNodeIds?: string[];
  /**
   * The node this finding belongs to. Set centrally as the finding is attached,
   * so the flattened report list can still say which file it came from.
   */
  nodeId?: string;
  /** 1-based line of `range.start`, resolved while the file text is in hand. */
  line?: number;
  /** 1-based line of the range's last character; equals `line` for one-liners. */
  lineEnd?: number;
}

export interface ContextRange {
  start: number;
  end: number;
}

export interface ContextNode {
  /** Stable within a report. Derived from the resolved absolute path. */
  id: string;
  /** Absolute, daemon-side. Never displayed raw. */
  path: string;
  /** Display path: relative to the project root, or `~/…` under home. */
  relPath: string;
  scope: ContextScope;
  category: ContextCategory;
  costClass: ContextCostClass;
  bytes: number;
  estTokens: number;
  /**
   * Additional parents that also reach this node. The node is listed — and
   * counted — exactly once; these render as a dimmed "also imported by" chip
   * rather than a second row (charter §6.2).
   */
  alsoImportedByNodeIds: string[];
  findings: ContextFinding[];
}

export interface ContextEdge {
  fromNodeId: string;
  /** Null when the target could not be resolved — pairs with a `dead_*` finding. */
  toNodeId: string | null;
  kind: "import" | "reference";
  /** The literal path text as written in the parent, e.g. `docs/foo.md`. */
  rawTarget: string;
  /**
   * Byte range of the whole reference token in the parent file. This is what
   * makes "Always load ↔ Link only" a deterministic single-span edit instead of
   * a re-parse (charter §7.1).
   */
  range: ContextRange;
}

export interface ContextCategoryTotal {
  category: ContextCategory;
  estTokens: number;
  /** Share of the evaluated context window, 0–100, one decimal place. */
  sharePercent: number;
  severity: ContextSeverity;
}

export interface ContextReport {
  provider: string;
  /** The window the report was evaluated against (picker or active model). */
  windowTokens: number;
  scannedAt: string;
  confidence: ContextConfidence;
  nodes: ContextNode[];
  edges: ContextEdge[];
  categoryTotals: ContextCategoryTotal[];
  /** Rides every request. The headline number. */
  fixedTotal: number;
  /** Loads only when the agent works in that area. */
  conditionalTotal: number;
  /** Reachable by link; never counted as cost. */
  referencedTotal: number;
  /** windowTokens - fixedTotal, floored at 0. What's left for the conversation. */
  workingRoom: number;
  aggregateSeverity: ContextSeverity;
  findings: ContextFinding[];
}
