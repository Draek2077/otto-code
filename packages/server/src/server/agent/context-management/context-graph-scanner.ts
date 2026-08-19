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
import { locateFinding } from "./finding-location.js";
import {
  extractMarkdownRefs,
  hasFileExtension,
  isMarkdownTarget,
  stripTargetFragment,
  type MarkdownRef,
} from "./markdown-refs.js";
import {
  getProviderConvention,
  type ContextLoadPoint,
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
  /**
   * Absolute paths the scan tested and found absent, where the file appearing
   * would change what loads.
   *
   * A load point's candidates are here until one of them wins (an added
   * `AGENTS.md` takes the slot from the `CLAUDE.md` that was standing in for
   * it), as are import targets that did not resolve. Markdown link targets are
   * not: a link is never inlined, so creating one changes a finding and not a
   * byte of the prompt.
   *
   * This is what makes `instruction-files.ts` able to cache by mtime. Watching
   * only the files that *did* resolve would miss the file that appears where
   * there was none, which is the same silent staleness the whole runtime-only
   * loading rule exists to prevent.
   */
  absentPaths: string[];
  /**
   * Node text, in load order, for the nodes whose bytes came from a real file
   * read. Present only when `includeText` was requested: the loader needs the
   * bytes it is about to send, and everyone else only needs the sizes.
   */
  contents?: ContextFileContent[];
}

export interface ScanContextGraphOptions {
  /**
   * Resolve only fixed-weight load points and the imports they pull in,
   * skipping the subdirectory sweep and the skills/subagents roster. The loader
   * wants exactly the bytes that ride every request; walking a repo to size
   * weight it is not about to send is pure latency at session start.
   */
  fixedOnly?: boolean;
  /**
   * Scan exactly these load points instead of the convention's own list, and
   * nothing else - no subdirectory sweep, no roster.
   *
   * This is how one conditional subdirectory file gets read with the same
   * import inlining, cycle guard and depth cap the fixed chain gets. The
   * alternative was a second walk inside the injector, and a second walk is how
   * the tab and the prompt start disagreeing (`instruction-files.ts`).
   */
  loadPoints?: readonly ContextLoadPoint[];
  /** Return `contents` alongside the graph. */
  includeText?: boolean;
  /** The provider drives its own request - see `getProviderConvention`. */
  ownsContextPayload?: boolean;
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
  options?: ScanContextGraphOptions,
): Promise<ContextGraphScanResult> {
  const convention = getProviderConvention(provider, {
    ownsContextPayload: options?.ownsContextPayload,
  });
  if (!convention) {
    return {
      nodes: [],
      edges: [],
      findings: [],
      absentPaths: [],
      confidence: "unverified",
      supportsImports: false,
      supported: false,
    };
  }

  const builder = new GraphBuilder(input);

  // An explicit `loadPoints` list is the whole scan: the caller is reading one
  // named slot, so sweeping the repo and the roster around it would be work
  // nobody asked for, sizing weight nobody is about to send.
  const pointsOnly = options?.fixedOnly === true || options?.loadPoints !== undefined;

  // 1. Explicit load points, then 2. subdirectory files - see the seed helpers.
  //    Load order is what "first visit wins" means, so it must not be reordered.
  const queue: PendingImport[] = await seedLoadPoints(
    builder,
    options?.loadPoints ?? convention.resolveLoadPoints(input),
  );
  if (!pointsOnly) {
    queue.push(...(await seedSubdirectoryFiles(builder, convention, input)));
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

  // 4. Skills and subagents - see `addRoster`.
  if (!pointsOnly) {
    await addRoster(builder, convention, input);
  }

  // 5. Content checks run last, once every file has been read - they compare
  //    files against each other, so they cannot be folded into the walk.
  const contents = builder.fileContents();
  collectContentFindings(contents);

  return {
    nodes: builder.nodes(),
    edges: builder.edges(),
    findings: builder.allFindings(),
    absentPaths: builder.absentPaths(),
    confidence: convention.confidence,
    supportsImports: convention.supportsImports,
    supported: true,
    ...(options?.includeText ? { contents } : {}),
  };
}

/**
 * Step 1: the provider's explicit load points, in load order.
 *
 * A load point may name several spellings of the same slot (`AGENTS.md` with a
 * `CLAUDE.md` fallback). The first candidate that exists takes the slot and the
 * alternates are never read - one slot, one file, counted once.
 */
async function seedLoadPoints(
  builder: GraphBuilder,
  points: readonly ContextLoadPoint[],
): Promise<PendingImport[]> {
  const seeds: PendingImport[] = [];
  for (const point of points) {
    const candidates = [point.path, ...(point.fallbackPaths ?? [])];
    for (const candidate of candidates) {
      const node = await builder.addFile({
        absolutePath: candidate,
        scope: point.scope,
        category: point.category,
        costClass: point.costClass,
      });
      if (!node) continue;
      seeds.push({
        fromNodeId: node.id,
        absolutePath: node.path,
        depth: 0,
        costClass: point.costClass,
        scope: point.scope,
      });
      break;
    }
  }
  return seeds;
}

/**
 * Step 2: context files below the scan root. Conditional weight - discovered so
 * the report can show it, never counted as fixed, because it reaches the model
 * only once the agent works in that subtree.
 */
async function seedSubdirectoryFiles(
  builder: GraphBuilder,
  convention: ProviderConvention,
  input: ContextResolutionInput,
): Promise<PendingImport[]> {
  const root = convention.resolveSubdirectoryScanRoot(input);
  if (!root || convention.subdirectoryFileNames.length === 0) return [];

  const seeds: PendingImport[] = [];
  for (const filePath of await findSubdirectoryContextFiles(
    root,
    convention.subdirectoryFileNames,
  )) {
    const node = await builder.addFile({
      absolutePath: filePath,
      scope: "subdirectory",
      category: "context_files",
      costClass: "conditional",
    });
    if (!node) continue;
    seeds.push({
      fromNodeId: node.id,
      absolutePath: node.path,
      depth: 0,
      costClass: "conditional",
      scope: "subdirectory",
    });
  }
  return seeds;
}

/**
 * Step 4 of the scan, extracted so `scanContextGraph` stays under the
 * complexity ceiling: skills and subagents, from the provider's own roots and
 * from every enabled plugin.
 *
 * Only the frontmatter rides every request - the body loads on invocation, so
 * sizing the whole file would overstate it badly. Plugin-contributed rosters
 * count the same as hand-written ones: the model is told about them
 * identically, and the user's lever (disable the plugin) only makes sense if
 * the weight is visible first.
 */
async function addRoster(
  builder: GraphBuilder,
  convention: ProviderConvention,
  input: ContextResolutionInput,
): Promise<void> {
  const pluginRoots = (await convention.resolvePluginRoots?.(input)) ?? [];

  const skillRoots = [
    ...convention.resolveSkillRoots(input),
    ...pluginRoots.map((root) => path.join(root, "skills")),
  ];
  for (const skillRoot of skillRoots) {
    for (const skillFile of await listSkillFiles(skillRoot)) {
      await addRosterEntry(builder, skillFile, skillRoot, input);
    }
  }

  const agentRoots = [
    ...convention.resolveAgentRoots(input),
    ...pluginRoots.map((root) => path.join(root, "agents")),
  ];
  for (const agentRoot of agentRoots) {
    for (const agentFile of await listAgentFiles(agentRoot)) {
      await addRosterEntry(builder, agentFile, agentRoot, input);
    }
  }
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
    // Recorded whether or not it is flagged: `@some-package` is not a finding,
    // but a file that later appears at that path would still change the load.
    if (targetPath) builder.recordAbsentPath(targetPath);
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
    // and do not re-walk - that is also the cycle guard.
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
  private readonly absentPathSet = new Set<string>();
  private readonly textByNodeId = new Map<string, string>();
  private readonly parentByNodeId = new Map<string, string>();
  private readonly edgeList: ContextEdge[] = [];

  constructor(private readonly input: ContextResolutionInput) {}

  /** Case-insensitive on Windows, where the same file has many spellings. */
  private key(absolutePath: string): string {
    return contextPathKey(absolutePath);
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
      // where a file *would* live. Which is exactly why the path is worth
      // reporting - `absentPaths` is how a cache learns that a file appearing
      // here changes the answer.
      this.recordAbsentPath(input.absolutePath);
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

  recordAbsentPath(absolutePath: string): void {
    this.absentPathSet.add(path.resolve(absolutePath));
  }

  absentPaths(): string[] {
    return [...this.absentPathSet];
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
      // Only paths that name a file can be meaningfully "dead" - anchors and
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
    const node = this.nodesByKey.get(nodeId);
    if (!node) return;
    // Every scanner finding indexes the *parent's* bytes - the file that wrote
    // the reference - which is exactly the node it is being attached to.
    node.findings.push(locateFinding({ finding, nodeId, text: this.textByNodeId.get(nodeId) }));
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

/**
 * A path's identity for dedupe purposes: resolved, and case-insensitive on
 * Windows where two spellings name one file.
 *
 * Exported because the graph is not the only thing that must not visit a
 * directory twice: the tool loop's subtree injector keys its already-injected
 * set the same way, and a second spelling of a directory it already read would
 * inject those instructions all over again.
 */
export function contextPathKey(absolutePath: string): string {
  const resolved = path.resolve(absolutePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function isReadableFile(absolutePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(absolutePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

/**
 * Adds one roster entry (a skill or a subagent) sized by its frontmatter.
 * Entries whose frontmatter cannot be read contribute nothing rather than their
 * whole body - an unparseable file is not evidence of a large advertisement.
 */
async function addRosterEntry(
  builder: GraphBuilder,
  filePath: string,
  rootDir: string,
  input: ContextResolutionInput,
): Promise<void> {
  const frontmatter = await readFrontmatter(filePath);
  if (frontmatter == null) return;
  await builder.addSyntheticNode({
    absolutePath: filePath,
    // Plugin roots live under the home config dir, so they land on `global`
    // here - which is true: enabling a plugin costs every project on the machine.
    scope: rootDir.startsWith(input.homeDir) ? "global" : "project",
    category: "skills_roster",
    costClass: "fixed",
    bytes: frontmatter.length,
  });
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
 * Subagents are flat `*.md` files in the directory, not `<name>/SKILL.md`
 * bundles - the one structural difference between the two rosters.
 */
async function listAgentFiles(agentRoot: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(agentRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => path.join(agentRoot, entry.name));
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
  return extractFrontmatter(text);
}

/**
 * Exported so the prompt preview shows a roster entry the way the model gets it
 * - frontmatter only. Two copies of this rule would drift, and the preview would
 * quietly start showing skill bodies that are not in the request.
 */
export function extractFrontmatter(text: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return match ? (match[1] ?? null) : null;
}

/**
 * Every directory under `root` carrying one of `fileNames`, at most one file per
 * directory: the names are an ordered preference list, so a directory holding
 * both `AGENTS.md` and `CLAUDE.md` contributes only the first. That is the same
 * one-slot-several-spellings rule the fixed load points follow, and it is what
 * stops this sweep and the injector from picking different files for the same
 * directory.
 */
async function findSubdirectoryContextFiles(
  root: string,
  fileNames: readonly string[],
): Promise<string[]> {
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
    // The root's own file is a fixed load point, not a conditional one.
    if (path.resolve(dir) !== path.resolve(root)) {
      const present = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
      const winner = fileNames.find((name) => present.has(name));
      if (winner) matches.push(path.join(dir, winner));
    }
    for (const entry of entries) {
      if (matches.length >= SUBDIRECTORY_SCAN_MAX_MATCHES) return;
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) continue;
      await walk(path.join(dir, entry.name), depth + 1);
    }
  }

  await walk(root, 0);
  return matches;
}
