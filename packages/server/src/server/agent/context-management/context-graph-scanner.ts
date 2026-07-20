/**
 * Resolves the graph of context a provider loads for a workspace
 * (charter §2, §6.2).
 *
 * Invariants this file exists to hold:
 *
 * - **Every file is listed once and counted once.** First visit wins in load
 *   order; later parents attach as `alsoImportedByNodeIds`. Double-counting a
 *   twice-imported file would make the headline number a lie.
 * - **Imports are traversed; references are not.** A referenced file is not in
 *   the request, so nothing it imports is either.
 * - **Cycles terminate, depth is capped**, and both produce a finding rather
 *   than silent truncation.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { estimateTokens } from "../context-composition.js";
import { collectContentFindings, type ContextFileContent } from "./content-findings.js";
import {
  extractMarkdownRefs,
  hasFileExtension,
  isMarkdownTarget,
  stripTargetFragment,
  type MarkdownRef,
} from "./markdown-refs.js";
import {
  getProviderConvention,
  type ContextResolutionInput,
  type ProviderConvention,
} from "./provider-conventions.js";
import type {
  ContextConfidence,
  ContextCostClass,
  ContextEdge,
  ContextFinding,
  ContextNode,
  ContextScope,
} from "./types.js";

/** Guards against pathological repos; overflow is reported, never silent. */
const SUBDIRECTORY_SCAN_MAX_DEPTH = 6;
const SUBDIRECTORY_SCAN_MAX_MATCHES = 200;
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".expo",
  "coverage",
]);

export interface ContextGraphScanResult {
  nodes: ContextNode[];
  edges: ContextEdge[];
  findings: ContextFinding[];
  confidence: ContextConfidence;
  supportsImports: boolean;
  supported: boolean;
}

interface PendingImport {
  fromNodeId: string;
  absolutePath: string;
  depth: number;
  costClass: ContextCostClass;
  scope: ContextScope;
}

export async function scanContextGraph(
  provider: string,
  input: ContextResolutionInput,
): Promise<ContextGraphScanResult> {
  const convention = getProviderConvention(provider);
  if (!convention) {
    return {
      nodes: [],
      edges: [],
      findings: [],
      confidence: "unverified",
      supportsImports: false,
      supported: false,
    };
  }

  const builder = new GraphBuilder(input);

  // 1. Explicit load points, in load order — this order is what "first visit
  //    wins" means, so it must not be reordered.
  const queue: PendingImport[] = [];
  for (const point of convention.resolveLoadPoints(input)) {
    const node = await builder.addFile({
      absolutePath: point.path,
      scope: point.scope,
      category: point.category,
      costClass: point.costClass,
    });
    if (!node) continue;
    queue.push({
      fromNodeId: node.id,
      absolutePath: node.path,
      depth: 0,
      costClass: point.costClass,
      scope: point.scope,
    });
  }

  // 2. Subdirectory context files — conditional weight, discovered but never
  //    counted as fixed.
  const subdirectoryRoot = convention.resolveSubdirectoryScanRoot(input);
  if (subdirectoryRoot && convention.subdirectoryFileName) {
    const found = await findSubdirectoryContextFiles(
      subdirectoryRoot,
      convention.subdirectoryFileName,
    );
    for (const filePath of found) {
      const node = await builder.addFile({
        absolutePath: filePath,
        scope: "subdirectory",
        category: "context_files",
        costClass: "conditional",
      });
      if (!node) continue;
      queue.push({
        fromNodeId: node.id,
        absolutePath: node.path,
        depth: 0,
        costClass: "conditional",
        scope: "subdirectory",
      });
    }
  }

  // 3. Walk the graph. Imports inherit their parent's cost class; references
  //    are recorded but never traversed.
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const text = builder.getText(current.fromNodeId);
    if (text == null) continue;

    for (const ref of extractMarkdownRefs(text)) {
      const next = await processRef({ builder, convention, current, ref });
      if (next) queue.push(next);
    }
  }

  // 4. Skills roster — only the frontmatter rides every request; the body loads
  //    on invocation, so sizing the whole file would overstate it badly.
  for (const skillRoot of convention.resolveSkillRoots(input)) {
    for (const skillFile of await listSkillFiles(skillRoot)) {
      const frontmatter = await readFrontmatter(skillFile);
      if (frontmatter == null) continue;
      await builder.addSyntheticNode({
        absolutePath: skillFile,
        scope: skillRoot.startsWith(input.homeDir) ? "global" : "project",
        category: "skills_roster",
        costClass: "fixed",
        bytes: frontmatter.length,
      });
    }
  }

  // 5. Content checks run last, once every file has been read — they compare
  //    files against each other, so they cannot be folded into the walk.
  collectContentFindings(builder.fileContents());

  return {
    nodes: builder.nodes(),
    edges: builder.edges(),
    findings: builder.allFindings(),
    confidence: convention.confidence,
    supportsImports: convention.supportsImports,
    supported: true,
  };
}

/**
 * Handles one outbound reference. Returns the next node to walk, or null when
 * nothing new joined the graph (a reference, a dead target, an already-visited
 * node, or a depth-capped chain).
 */
async function processRef(params: {
  builder: GraphBuilder;
  convention: ProviderConvention;
  current: PendingImport;
  ref: MarkdownRef;
}): Promise<PendingImport | null> {
  const { builder, convention, current, ref } = params;
  const targetPath = builder.resolveTarget(current.absolutePath, ref.rawTarget);
  const range = { start: ref.start, end: ref.end };

  if (ref.kind === "reference") {
    await builder.addReferenceEdge({
      fromNodeId: current.fromNodeId,
      targetPath,
      rawTarget: ref.rawTarget,
      range,
    });
    return null;
  }

  // On a provider with no import mechanism, `@path` is ordinary prose the
  // agent renders literally. Counting it as loaded would overstate the bill,
  // and flagging it as a dead import would be a false alarm.
  if (!convention.supportsImports) return null;

  // A candidate that does not resolve is either a dead import or not a path at
  // all (`@otto-code/protocol`); only flag the ones that look like markdown, so
  // package names stay quiet.
  const exists = targetPath ? await isReadableFile(targetPath) : false;
  if (!targetPath || !exists) {
    if (isMarkdownTarget(ref.rawTarget)) {
      builder.addFinding(current.fromNodeId, {
        kind: "dead_import",
        message: `Always-loaded file "${ref.rawTarget}" does not exist`,
        range,
      });
      builder.addEdge({
        fromNodeId: current.fromNodeId,
        toNodeId: null,
        kind: "import",
        rawTarget: ref.rawTarget,
        range,
      });
    }
    return null;
  }

  if (current.depth + 1 > convention.importDepthCap) {
    builder.addFinding(current.fromNodeId, {
      kind: "depth_capped",
      message: `Import chain deeper than ${convention.importDepthCap} levels stops at "${ref.rawTarget}"`,
      range,
    });
    return null;
  }

  const existing = builder.findByPath(targetPath);
  if (existing) {
    builder.addEdge({
      fromNodeId: current.fromNodeId,
      toNodeId: existing.id,
      kind: "import",
      rawTarget: ref.rawTarget,
      range,
    });
    // Already on the graph: record the extra parent, do not re-add or re-count,
    // and do not re-walk — that is also the cycle guard.
    builder.addAdditionalParent(existing.id, current.fromNodeId);
    if (builder.isAncestor(existing.id, current.fromNodeId)) {
      builder.addFinding(current.fromNodeId, {
        kind: "import_cycle",
        message: `"${ref.rawTarget}" is part of an import cycle; it is sent once`,
        range,
        relatedNodeIds: [existing.id],
      });
    }
    return null;
  }

  const node = await builder.addFile({
    absolutePath: targetPath,
    scope: current.scope,
    category: "context_files",
    costClass: current.costClass,
  });
  if (!node) return null;
  builder.addEdge({
    fromNodeId: current.fromNodeId,
    toNodeId: node.id,
    kind: "import",
    rawTarget: ref.rawTarget,
    range,
  });
  builder.setParent(node.id, current.fromNodeId);
  return {
    fromNodeId: node.id,
    absolutePath: node.path,
    depth: current.depth + 1,
    costClass: current.costClass,
    scope: current.scope,
  };
}

interface AddFileInput {
  absolutePath: string;
  scope: ContextScope;
  category: ContextNode["category"];
  costClass: ContextCostClass;
}

class GraphBuilder {
  private readonly nodesByKey = new Map<string, ContextNode>();
  private readonly textByNodeId = new Map<string, string>();
  private readonly parentByNodeId = new Map<string, string>();
  private readonly edgeList: ContextEdge[] = [];

  constructor(private readonly input: ContextResolutionInput) {}

  /** Case-insensitive on Windows, where the same file has many spellings. */
  private key(absolutePath: string): string {
    const resolved = path.resolve(absolutePath);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  }

  findByPath(absolutePath: string): ContextNode | undefined {
    return this.nodesByKey.get(this.key(absolutePath));
  }

  getText(nodeId: string): string | undefined {
    return this.textByNodeId.get(nodeId);
  }

  async addFile(input: AddFileInput): Promise<ContextNode | null> {
    const key = this.key(input.absolutePath);
    const existing = this.nodesByKey.get(key);
    if (existing) return existing;

    let text: string;
    try {
      text = await fs.readFile(input.absolutePath, "utf8");
    } catch {
      // Absent candidates are the norm, not an error: conventions describe
      // where a file *would* live.
      return null;
    }

    const node = this.makeNode({ ...input, bytes: Buffer.byteLength(text, "utf8") });
    this.nodesByKey.set(key, node);
    this.textByNodeId.set(node.id, text);
    return node;
  }

  /** A node whose size is not its file size (skills: frontmatter only). */
  async addSyntheticNode(input: AddFileInput & { bytes: number }): Promise<ContextNode | null> {
    const key = this.key(input.absolutePath);
    if (this.nodesByKey.has(key)) return this.nodesByKey.get(key) ?? null;
    const node = this.makeNode(input);
    this.nodesByKey.set(key, node);
    return node;
  }

  private makeNode(input: AddFileInput & { bytes: number }): ContextNode {
    return {
      id: this.key(input.absolutePath),
      path: path.resolve(input.absolutePath),
      relPath: this.displayPath(input.absolutePath),
      scope: input.scope,
      category: input.category,
      costClass: input.costClass,
      bytes: input.bytes,
      estTokens: estimateTokens(input.bytes),
      alsoImportedByNodeIds: [],
      findings: [],
    };
  }

  /** Project-relative where possible, `~/…` under home, absolute otherwise. */
  private displayPath(absolutePath: string): string {
    const resolved = path.resolve(absolutePath);
    const fromProject = path.relative(this.input.projectRoot, resolved);
    if (fromProject && !fromProject.startsWith("..") && !path.isAbsolute(fromProject)) {
      return fromProject.split(path.sep).join("/");
    }
    const fromHome = path.relative(this.input.homeDir, resolved);
    if (fromHome && !fromHome.startsWith("..") && !path.isAbsolute(fromHome)) {
      return `~/${fromHome.split(path.sep).join("/")}`;
    }
    return resolved;
  }

  resolveTarget(fromPath: string, rawTarget: string): string | null {
    const cleaned = stripTargetFragment(rawTarget);
    if (cleaned.length === 0) return null;
    if (cleaned.startsWith("~/")) {
      return path.resolve(this.input.homeDir, cleaned.slice(2));
    }
    if (path.isAbsolute(cleaned)) return path.resolve(cleaned);
    return path.resolve(path.dirname(fromPath), cleaned);
  }

  addEdge(edge: ContextEdge): void {
    this.edgeList.push(edge);
  }

  async addReferenceEdge(params: {
    fromNodeId: string;
    targetPath: string | null;
    rawTarget: string;
    range: { start: number; end: number };
  }): Promise<void> {
    const { fromNodeId, targetPath, rawTarget, range } = params;
    const exists = targetPath ? await isReadableFile(targetPath) : false;

    if (!exists) {
      // Only paths that name a file can be meaningfully "dead" — anchors and
      // directory links would be noise.
      if (hasFileExtension(rawTarget)) {
        this.addFinding(fromNodeId, {
          kind: "dead_reference",
          message: `Link target "${rawTarget}" does not exist`,
          range,
        });
      }
      this.addEdge({ fromNodeId, toNodeId: null, kind: "reference", rawTarget, range });
      return;
    }

    // Only markdown targets join the graph as nodes; a link to a source file is
    // a real link but not context.
    if (!targetPath || !isMarkdownTarget(rawTarget)) {
      this.addEdge({ fromNodeId, toNodeId: null, kind: "reference", rawTarget, range });
      return;
    }

    const existing = this.findByPath(targetPath);
    if (existing) {
      this.addEdge({ fromNodeId, toNodeId: existing.id, kind: "reference", rawTarget, range });
      return;
    }
    const node = await this.addFile({
      absolutePath: targetPath,
      scope: "project",
      category: "context_files",
      costClass: "referenced",
    });
    this.addEdge({
      fromNodeId,
      toNodeId: node?.id ?? null,
      kind: "reference",
      rawTarget,
      range,
    });
  }

  setParent(nodeId: string, parentId: string): void {
    if (!this.parentByNodeId.has(nodeId)) this.parentByNodeId.set(nodeId, parentId);
  }

  addAdditionalParent(nodeId: string, parentId: string): void {
    const node = this.nodesByKey.get(nodeId);
    if (!node || node.id === parentId) return;
    if (this.parentByNodeId.get(nodeId) === parentId) return;
    if (!node.alsoImportedByNodeIds.includes(parentId)) {
      node.alsoImportedByNodeIds.push(parentId);
    }
  }

  /** True when `candidateAncestorId` is reachable upward from `nodeId`. */
  isAncestor(candidateAncestorId: string, nodeId: string): boolean {
    const seen = new Set<string>();
    let current: string | undefined = nodeId;
    while (current && !seen.has(current)) {
      if (current === candidateAncestorId) return true;
      seen.add(current);
      current = this.parentByNodeId.get(current);
    }
    return false;
  }

  addFinding(nodeId: string, finding: ContextFinding): void {
    this.nodesByKey.get(nodeId)?.findings.push(finding);
  }

  nodes(): ContextNode[] {
    return [...this.nodesByKey.values()];
  }

  /** Nodes whose bytes came from a real file read, paired with that text. */
  fileContents(): ContextFileContent[] {
    const contents: ContextFileContent[] = [];
    for (const node of this.nodesByKey.values()) {
      const text = this.textByNodeId.get(node.id);
      // Synthetic nodes (skills roster) have no body to compare.
      if (text != null) contents.push({ node, text });
    }
    return contents;
  }

  edges(): ContextEdge[] {
    return this.edgeList;
  }

  allFindings(): ContextFinding[] {
    return this.nodes().flatMap((node) => node.findings);
  }
}

async function isReadableFile(absolutePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(absolutePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function listSkillFiles(skillRoot: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(skillRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(skillRoot, entry.name, "SKILL.md");
    if (await isReadableFile(candidate)) files.push(candidate);
  }
  return files;
}

/**
 * A skill's fixed cost is its frontmatter (name + description), which is what
 * goes into the roster. The body only loads when the skill is invoked.
 */
async function readFrontmatter(filePath: string): Promise<string | null> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return match ? (match[1] ?? null) : null;
}

async function findSubdirectoryContextFiles(root: string, fileName: string): Promise<string[]> {
  const matches: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > SUBDIRECTORY_SCAN_MAX_DEPTH || matches.length >= SUBDIRECTORY_SCAN_MAX_MATCHES) {
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (matches.length >= SUBDIRECTORY_SCAN_MAX_MATCHES) return;
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) continue;
        await walk(path.join(dir, entry.name), depth + 1);
        continue;
      }
      // The root's own file is a fixed load point, not a conditional one.
      if (entry.name === fileName && path.resolve(dir) !== path.resolve(root)) {
        matches.push(path.join(dir, entry.name));
      }
    }
  }

  await walk(root, 0);
  return matches;
}
