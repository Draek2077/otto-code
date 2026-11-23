import { inspectNativeRosters } from "./native-roster.js";
import { claudeInstructionText } from "./native-comments.js";
import path from "node:path";
import { minimatch } from "minimatch";
import { instructionDigest, type InstructionReference } from "@getpaseo/plugin/server/otto-openai";
import type { ContextCategory } from "@getpaseo/plugin/otto/context-management";
import type { NativeContextPlan, NativeLoadPoint } from "./native-plan.js";
import { NativeContextFiles, type NativeFile } from "./native-files.js";
import { memoryIndexHead, nativeReferences, ruleMetadata } from "./native-text.js";
import { within } from "./graph.js";

export interface NativeContextEntry {
  file: string;
  text: string;
  countedText: string;
  category: ContextCategory;
  scope: "host" | "project" | "subdirectory";
  costClass: "fixed" | "conditional" | "referenced";
  label: string;
  revision: string;
  imports: boolean;
  contextStart?: number;
  contextLength?: number;
}
export interface NativeContextDependency {
  file: string;
  start: number;
  end: number;
  target: string;
  resolved: string | null;
  kind: "import" | "reference";
  resolution: "resolved" | "missing" | "outside" | "unavailable" | "depth_capped" | "excluded";
}
export interface NativeContextInventory {
  entries: NativeContextEntry[];
  dependencies: NativeContextDependency[];
  notes: string[];
}
export interface NativeInventoryInput {
  plan: NativeContextPlan;
  root: string;
  userHome: string;
  /** Canonical provider roots supplied by the owning daemon, never by a client. */
  readableRoots: string[];
  files?: NativeContextFiles;
}
function expandHome(value: string, home: string): string {
  return value.startsWith("~/") || value.startsWith("~\\")
    ? path.join(home, value.slice(2))
    : value;
}
function excluded(file: string, input: NativeInventoryInput): boolean {
  const candidates = [file, path.relative(input.root, file)].map((value) =>
    value.split(path.sep).join("/"),
  );
  return input.plan.excludes.some((pattern) =>
    candidates.some((value) =>
      minimatch(value, pattern, { dot: true, nocase: process.platform === "win32" }),
    ),
  );
}
function byteHead(text: string, limit: number): string {
  let bytes = Buffer.from(text, "utf8").subarray(0, limit);
  while (!Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes)) bytes = bytes.subarray(0, -1);
  return bytes.toString("utf8");
}

/** Read-only convention inventory. It never claims these bytes were observed in a native request. */
export async function inspectNativeContext(
  input: NativeInventoryInput,
): Promise<NativeContextInventory> {
  const files = input.files ?? new NativeContextFiles();
  const entries = new Map<string, NativeContextEntry>();
  const dependencies: NativeContextDependency[] = [];
  let remaining = input.plan.instructionBytes;
  const permitted = (file: string) =>
    within(input.root, file) || input.readableRoots.some((root) => within(root, file));
  const label = (file: string) =>
    within(input.root, file) ? path.relative(input.root, file) : file;
  function add(
    source: NativeFile,
    category: ContextCategory,
    costClass: NativeContextEntry["costClass"],
    countedText: string,
    imports: boolean,
  ): NativeContextEntry | null {
    const prior = entries.get(source.file);
    if (prior && (prior.costClass !== "referenced" || costClass === "referenced")) return prior;
    if (entries.size >= 256) {
      files.note("Only the first 256 Context sources are inventoried.");
      return null;
    }
    const entry: NativeContextEntry = {
      ...source,
      countedText,
      category,
      costClass,
      imports,
      scope: within(input.root, source.file) ? "project" : "host",
      label: label(source.file),
      revision: instructionDigest(source.text),
    };
    if (costClass === "conditional" && entry.scope === "project") entry.scope = "subdirectory";
    entries.set(source.file, entry);
    return entry;
  }
  function availableSource(
    target: { file: string; revision?: string; text?: string },
    category: ContextCategory,
  ): void {
    if (entries.has(target.file)) return;
    const available = add(
      { file: target.file, text: "" },
      category,
      "referenced",
      "",
      input.plan.imports,
    );
    if (available) available.revision = target.revision ?? instructionDigest(target.text ?? "");
  }
  async function inspectDependency(
    source: NativeFile,
    reference: InstructionReference,
    point: Pick<NativeLoadPoint, "category" | "memoryIndex">,
    costClass: NativeContextEntry["costClass"],
    depth: number,
    chain: string[],
  ): Promise<void> {
    const candidate = path.resolve(
      path.dirname(source.file),
      expandHome(reference.target, input.userHome),
    );
    const dependency: NativeContextDependency = {
      file: source.file,
      ...reference,
      resolved: null,
      resolution: "unavailable",
    };
    dependencies.push(dependency);
    if (!permitted(candidate)) {
      dependency.resolution = "outside";
      files.note(
        `External dependency requires provider approval and is not inspected: ${reference.target}`,
      );
      return;
    }
    const target =
      reference.kind === "reference" ||
      depth >= input.plan.importDepth ||
      excluded(candidate, input)
        ? await files.identity(candidate)
        : await files.read(candidate);
    if (!target || !permitted(target.file)) {
      dependency.resolution = target ? "outside" : files.failure(candidate);
      files.note(`Missing or unavailable dependency: ${reference.target}`);
      return;
    }
    dependency.resolved = target.file;
    dependency.resolution = "resolved";
    if (reference.kind === "reference") availableSource(target, point.category);
    else if (excluded(candidate, input) || excluded(target.file, input)) {
      dependency.resolution = "excluded";
      availableSource(target, point.category);
    } else if (depth >= input.plan.importDepth) {
      dependency.resolution = "depth_capped";
      availableSource(target, point.category);
      files.note(`Import depth limit reached at ${reference.target}.`);
    } else if ("text" in target)
      await instruction(target, point, costClass, depth + 1, [...chain, source.file]);
  }
  async function instruction(
    source: NativeFile,
    point: Pick<NativeLoadPoint, "category" | "memoryIndex">,
    costClass: NativeContextEntry["costClass"],
    depth = 0,
    chain: string[] = [],
  ): Promise<void> {
    if (excluded(source.file, input)) return;
    if (chain.includes(source.file)) {
      files.note(`Import cycle through ${label(source.file)}.`);
      return;
    }
    const prior = entries.get(source.file);
    if (prior && prior.costClass !== "referenced") return;
    const contextStart = source.contextStart ?? 0;
    const contextText = source.text.slice(contextStart);
    let countedText = contextText;
    if (point.memoryIndex) countedText = memoryIndexHead(countedText);
    else if (costClass === "fixed") {
      countedText = byteHead(countedText, remaining);
      remaining -= Buffer.byteLength(countedText, "utf8");
      if (countedText !== contextText)
        files.note("The provider instruction byte limit truncates this convention estimate.");
    }
    const referenceText = countedText;
    if (input.plan.provider === "claude") countedText = claudeInstructionText(countedText);
    const entry = add(source, point.category, costClass, countedText, input.plan.imports);
    if (!entry) return;
    entry.contextStart = contextStart;
    entry.contextLength = referenceText.length;
    for (const original of nativeReferences(referenceText, input.plan.imports)) {
      const reference = {
        ...original,
        start: original.start + contextStart,
        end: original.end + contextStart,
      };
      if (dependencies.length >= 256) {
        files.note("Only the first 256 Context dependencies are inventoried.");
        break;
      }
      await inspectDependency(source, reference, point, costClass, depth, chain);
    }
  }
  async function first(point: NativeLoadPoint): Promise<NativeFile | null> {
    for (const candidate of point.candidates) {
      const source = await files.read(candidate);
      if (source && (!point.firstNonempty || source.text.trim())) return source;
    }
    return null;
  }
  const selected = await selectLoadPoints(input.plan, first);
  for (const { point, source } of selected) await instruction(source, point, "fixed");
  async function rule(candidate: string, conditional: boolean): Promise<void> {
    const source = await files.read(candidate);
    if (!source || !permitted(source.file)) return;
    const metadata = ruleMetadata(source.text);
    if (!metadata) {
      files.note(
        `Could not interpret path-scoped rules in ${label(source.file)}; their cost is unknown.`,
      );
      return;
    }
    await instruction(
      { ...source, contextStart: metadata.contextStart },
      { category: "context_files", memoryIndex: false },
      conditional || metadata.conditional ? "conditional" : "fixed",
    );
  }
  for (const ruleRoot of input.plan.ruleRoots) {
    for (const candidate of await files.walk(ruleRoot.directory, (relative) =>
      relative.endsWith(".md"),
    ))
      await rule(candidate, ruleRoot.conditional);
  }
  await configuredInstructions(input, files, async (source) =>
    instruction(source, { category: "context_files", memoryIndex: false }, "fixed"),
  );
  await inspectNativeRosters(input, files, add);
  if (input.plan.conditionalRoot) {
    const names = input.plan.conditionalNames;
    const matches = await files.walk(
      input.plan.conditionalRoot,
      (relative) =>
        names.some((name) => relative === name || relative.endsWith(`/${name}`)) ||
        /(?:^|\/)\.claude\/rules\/.*\.md$/u.test(relative),
    );
    for (const candidate of matches) {
      const relative = path
        .relative(input.plan.conditionalRoot, candidate)
        .split(path.sep)
        .join("/");
      if (names.includes(relative)) continue;
      if (candidate.split(path.sep).join("/").includes("/.claude/rules/")) {
        await rule(candidate, true);
        continue;
      }
      const source = await files.read(candidate);
      if (source && permitted(source.file))
        await instruction(source, { category: "context_files", memoryIndex: false }, "conditional");
    }
  }
  return {
    entries: [...entries.values()],
    dependencies,
    notes: [...input.plan.notes, ...files.notes],
  };
}

async function selectLoadPoints(
  plan: NativeContextPlan,
  read: (point: NativeLoadPoint) => Promise<NativeFile | null>,
) {
  const available: { point: NativeLoadPoint; source: NativeFile }[] = [];
  for (const point of plan.loadPoints) {
    const source = await read(point);
    if (source) available.push({ point, source });
  }
  const hasPrimary = available.some(({ point }) => point.gate === "claude-primary");
  return available.filter(({ point }) => {
    if (point.gate !== "claude-fallback") return true;
    return (
      plan.instructionMode === "claude-md-and-agents-md" ||
      (plan.instructionMode === "claude-md-or-agents-md" && !hasPrimary)
    );
  });
}

async function configuredInstructions(
  input: NativeInventoryInput,
  files: NativeContextFiles,
  consume: (source: NativeFile) => Promise<void>,
) {
  for (const { pattern, directories } of input.plan.configuredInstructions) {
    if (/^[a-z][a-z0-9+.-]*:/iu.test(pattern) && !path.isAbsolute(pattern)) {
      files.note("Remote configured instructions are not fetched; their input cost is unknown.");
      continue;
    }
    const expanded = expandHome(pattern, input.userHome);
    for (const directory of directories) {
      const absolute = path.resolve(directory, expanded);
      const hasMagic = /[*?{[]/u.test(expanded);
      let matches = [absolute];
      if (hasMagic) {
        const pieces = absolute.split(path.sep);
        const magicIndex = pieces.findIndex((piece) => /[*?{[]/u.test(piece));
        const rawPrefix = pieces.slice(0, magicIndex).join(path.sep) || path.parse(absolute).root;
        const prefix = path.isAbsolute(rawPrefix) ? rawPrefix : path.parse(absolute).root;
        matches = (
          await files.walk(prefix, (relative) =>
            minimatch(
              path.join(prefix, relative).split(path.sep).join("/"),
              absolute.split(path.sep).join("/"),
              { dot: true },
            ),
          )
        ).map((file) => file);
      }
      let found = false;
      for (const candidate of matches) {
        const source = await files.read(candidate);
        if (source) {
          found = true;
          await consume(source);
        }
      }
      if (found || path.isAbsolute(expanded)) break;
    }
  }
}
