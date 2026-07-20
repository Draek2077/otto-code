import type {
  ContextCategory,
  ContextEdge,
  ContextNode,
  ContextReport,
} from "@otto-code/protocol/messages";

/**
 * Flattens the report into the rows the tree renders.
 *
 * The graph is a DAG, but the tree lists every file exactly once: first visit
 * wins in load order, and any additional parent shows as an "also imported by"
 * note on the single row rather than a duplicate. That rule is enforced on the
 * daemon for the token totals; this module keeps the display honest to it.
 */

export type ContextRowKind = "category" | "node";

export interface ContextTreeRow {
  key: string;
  kind: ContextRowKind;
  depth: number;
  /** Present on `node` rows. */
  node?: ContextNode;
  /** Present on `category` rows. */
  category?: ContextCategory;
  /** Category rows roll up their subtree. */
  estTokens: number;
  /** How this row was reached: solid for always-loaded, dashed for link-only. */
  edgeKind?: "import" | "reference";
  hasChildren: boolean;
  expandable: boolean;
}

const CATEGORY_ORDER: ContextCategory[] = [
  "context_files",
  "memory_index",
  "skills_roster",
  "mcp_tools",
  "otto_injected",
  "system_prompt",
];

interface ChildLink {
  nodeId: string;
  edgeKind: "import" | "reference";
}

/**
 * Children by parent, deduplicated so a node claimed by an earlier parent is
 * not re-listed under a later one.
 */
function buildChildIndex(report: ContextReport): {
  childrenByNodeId: Map<string, ChildLink[]>;
  claimedNodeIds: Set<string>;
} {
  const childrenByNodeId = new Map<string, ChildLink[]>();
  const claimedNodeIds = new Set<string>();

  for (const edge of report.edges) {
    if (!edge.toNodeId) continue;
    if (claimedNodeIds.has(edge.toNodeId)) continue;
    // A node cannot be its own parent, and the root set is claimed by category.
    if (edge.toNodeId === edge.fromNodeId) continue;
    claimedNodeIds.add(edge.toNodeId);
    const existing = childrenByNodeId.get(edge.fromNodeId);
    const link: ChildLink = { nodeId: edge.toNodeId, edgeKind: edge.kind };
    if (existing) {
      existing.push(link);
    } else {
      childrenByNodeId.set(edge.fromNodeId, [link]);
    }
  }

  return { childrenByNodeId, claimedNodeIds };
}

export interface BuildContextTreeInput {
  report: ContextReport;
  expandedKeys: ReadonlySet<string>;
}

export function buildContextTree(input: BuildContextTreeInput): ContextTreeRow[] {
  const { report, expandedKeys } = input;
  const nodesById = new Map(report.nodes.map((node) => [node.id, node]));
  const { childrenByNodeId, claimedNodeIds } = buildChildIndex(report);
  const rows: ContextTreeRow[] = [];

  const emitNode = (link: ChildLink, depth: number): void => {
    const node = nodesById.get(link.nodeId);
    if (!node) return;
    const children = childrenByNodeId.get(node.id) ?? [];
    const expanded = expandedKeys.has(node.id);
    rows.push({
      key: node.id,
      kind: "node",
      depth,
      node,
      estTokens: node.estTokens,
      edgeKind: link.edgeKind,
      hasChildren: children.length > 0,
      expandable: children.length > 0,
    });
    if (!expanded) return;
    for (const child of children) emitNode(child, depth + 1);
  };

  for (const category of CATEGORY_ORDER) {
    // Roots of a category are the nodes nothing else claimed.
    const roots = report.nodes.filter(
      (node) => node.category === category && !claimedNodeIds.has(node.id),
    );
    const total = report.categoryTotals.find((entry) => entry.category === category);
    // Categories Otto knows only as a number (MCP schemas, injected prompt)
    // still deserve a row — they are often the biggest thing in the request.
    if (roots.length === 0 && !total) continue;

    const expanded = expandedKeys.has(category);
    rows.push({
      key: category,
      kind: "category",
      depth: 0,
      category,
      estTokens: total?.estTokens ?? roots.reduce((sum, node) => sum + node.estTokens, 0),
      hasChildren: roots.length > 0,
      expandable: roots.length > 0,
    });
    if (!expanded) continue;
    for (const root of roots) emitNode({ nodeId: root.id, edgeKind: "import" }, 1);
  }

  return rows;
}

/** Categories start open so the first thing a user sees is their real files. */
export function defaultExpandedKeys(report: ContextReport | null): Set<string> {
  const keys = new Set<string>(["context_files"]);
  if (!report) return keys;
  for (const node of report.nodes) {
    if (node.category === "context_files" && node.costClass === "fixed") keys.add(node.id);
  }
  return keys;
}

/** The row the tab opens with: the largest project-scoped file, else anything. */
export function pickInitialNode(report: ContextReport | null): ContextNode | null {
  if (!report) return null;
  const candidates = report.nodes.filter(
    (node) => node.category === "context_files" && node.costClass !== "referenced",
  );
  if (candidates.length === 0) return null;
  const projectScoped = candidates.filter((node) => node.scope === "project");
  const pool = projectScoped.length > 0 ? projectScoped : candidates;
  return pool.reduce((worst, node) => (node.estTokens > worst.estTokens ? node : worst));
}

/**
 * Every key that has to be open for `nodeId` to be a visible row: each parent
 * up the import chain, plus the category the chain roots in. Revealing a file
 * from the fix list is pointless if the row it lands on is still collapsed.
 */
export function ancestorKeysForNode(report: ContextReport | null, nodeId: string): string[] {
  if (!report) return [];
  const nodesById = new Map(report.nodes.map((node) => [node.id, node]));
  const parentByNodeId = new Map<string, string>();
  for (const edge of report.edges) {
    if (!edge.toNodeId || edge.toNodeId === edge.fromNodeId) continue;
    if (!parentByNodeId.has(edge.toNodeId)) parentByNodeId.set(edge.toNodeId, edge.fromNodeId);
  }

  const keys: string[] = [];
  const seen = new Set<string>([nodeId]);
  let current = nodeId;
  for (;;) {
    const parent = parentByNodeId.get(current);
    // The graph is a DAG in principle and a cycle in practice; `seen` is what
    // keeps a self-importing pair from spinning here.
    if (!parent || seen.has(parent)) break;
    seen.add(parent);
    keys.push(parent);
    current = parent;
  }

  const category = nodesById.get(current)?.category;
  if (category) keys.push(category);
  return keys;
}

/**
 * The edge that put this node in the request, plus the parent file that owns
 * the reference text. Both are needed to rewrite it: the range indexes the
 * parent's bytes.
 */
export interface InboundEdge {
  edge: ContextEdge;
  parent: ContextNode;
}

export function findInboundEdge(
  report: ContextReport | null,
  nodeId: string | null,
): InboundEdge | null {
  if (!report || !nodeId) return null;
  const edge = report.edges.find((candidate) => candidate.toNodeId === nodeId);
  if (!edge) return null;
  const parent = report.nodes.find((candidate) => candidate.id === edge.fromNodeId);
  if (!parent) return null;
  return { edge, parent };
}

/** Splits a daemon-absolute path into (directory, basename) on either separator. */
export function splitAbsolutePath(absolutePath: string): { dir: string; base: string } {
  const index = Math.max(absolutePath.lastIndexOf("/"), absolutePath.lastIndexOf("\\"));
  if (index <= 0) return { dir: absolutePath, base: absolutePath };
  return { dir: absolutePath.slice(0, index), base: absolutePath.slice(index + 1) };
}
