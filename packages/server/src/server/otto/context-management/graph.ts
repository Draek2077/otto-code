import path from "node:path";
import { realpath, stat } from "node:fs/promises";
import {
  instructionReferences,
  instructionDigest,
  type InstructionBlock,
} from "@getpaseo/plugin/server/otto-openai";
import type { ContextCategory, ContextReport } from "@getpaseo/plugin/otto/context-management";

export function within(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export interface GraphSource {
  loaded: boolean;
  file: string;
  text: string;
  scope: string;
  revision: string;
  editable: boolean;
  /** Native catalog membership is established by the daemon's bounded provider discovery. */
  native?: boolean;
  nativeImports?: boolean;
  category?: ContextCategory;
  countedText?: string;
  contextStart?: number;
  contextLength?: number;
}
export interface GraphEdge {
  file: string;
  start: number;
  end: number;
  target: string;
  kind: "import" | "reference";
}
/** References are availability, never loaded weight. Only runtime-resolved blocks cost tokens. */
export async function buildContextGraph(input: {
  blocks: readonly InstructionBlock[];
  root: string;
  home: string;
  cwd: string;
  issues?: readonly { kind: string; parentFile: string | null; target: string | null }[];
}) {
  const sources = new Map<string, GraphSource>();
  const edits = new Map<string, GraphEdge>();
  const nodes: ContextReport["nodes"] = [];
  const edges: ContextReport["edges"] = [];
  const findings: string[] = [];
  const idFor = (file: string) => instructionDigest(file);
  const labelFor = (file: string) =>
    within(input.home, file)
      ? `~/` + path.relative(input.home, file)
      : path.relative(input.root, file) || path.basename(file);
  for (const block of input.blocks) {
    const id = idFor(block.file);
    const editable = within(input.root, block.file) && !within(input.home, block.file);
    const conditional = editable && within(input.cwd, block.scope) && block.scope !== input.cwd;
    sources.set(id, {
      ...block,
      revision: instructionDigest(block.text),
      editable,
      loaded: true,
      category: "context_files",
    });
    nodes.push({
      id,
      label: labelFor(block.file),
      revision: instructionDigest(block.text),
      scope: sourceScope(editable, conditional),
      costClass: conditional ? "conditional" : "fixed",
      characters: block.text.length,
      estimatedTokens: Math.ceil(block.text.length / 4),
      editable,
      category: "context_files",
    });
  }
  const loaded = new Set(input.blocks.map((block) => block.file));
  for (const block of input.blocks) {
    for (const reference of instructionReferences(block.text)) {
      if (edges.length >= 256) {
        findings.push("Only the first 256 dependency edges are shown.");
        break;
      }
      const candidate = path.resolve(path.dirname(block.file), reference.target);
      const targetInfo = await resolveReference(
        candidate,
        input.root,
        input.home,
        findings,
        reference.target,
      );
      const target = targetInfo.kind === "resolved" ? targetInfo.file : null;
      const id = instructionDigest(JSON.stringify([block.file, reference.start, reference.end]));
      const depthCapped = input.issues?.some(
        (issue) =>
          issue.kind === "depth_capped" &&
          issue.parentFile === block.file &&
          issue.target === reference.target,
      );
      edges.push({
        id,
        from: idFor(block.file),
        to: target ? idFor(target) : null,
        kind: reference.kind,
        target: reference.target,
        resolution: depthCapped ? "depth_capped" : targetInfo.kind,
      });
      if (!target) findings.push(`Missing or outside the allowed roots: ${reference.target}`);
      if (
        targetInfo.kind === "resolved" &&
        !loaded.has(targetInfo.file) &&
        !sources.has(idFor(targetInfo.file))
      ) {
        const availableFile = targetInfo.file;
        nodes.push({
          id: idFor(availableFile),
          label: labelFor(availableFile),
          revision: targetInfo.revision,
          scope: within(input.home, availableFile) ? "host" : "project",
          costClass: "referenced",
          characters: 0,
          estimatedTokens: 0,
          editable: false,
        });
        sources.set(idFor(availableFile), {
          file: availableFile,
          scope: path.dirname(availableFile),
          text: "",
          revision: targetInfo.revision,
          editable: false,
          loaded: false,
        });
      }
      if (sources.get(idFor(block.file))?.editable)
        edits.set(id, { file: block.file, ...reference });
    }
  }
  findings.push(...cycleFindings(nodes, edges));
  return { sources, edits, nodes, edges, findings };
}

function cycleFindings(nodes: ContextReport["nodes"], edges: ContextReport["edges"]): string[] {
  const visiting = new Set<string>(),
    visited = new Set<string>(),
    cycles = new Set<string>();
  const imports = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind !== "import" || !edge.to) continue;
    const targets = imports.get(edge.from) ?? [];
    targets.push(edge.to);
    imports.set(edge.from, targets);
  }
  function visit(id: string): void {
    if (visiting.has(id)) {
      cycles.add(id);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of imports.get(id) ?? []) visit(target);
    visiting.delete(id);
    visited.add(id);
  }
  for (const node of nodes) visit(node.id);
  return [...cycles].map(
    (id) =>
      `Import cycle through ${nodes.find((node) => node.id === id)?.label ?? "an instruction source"}; the runtime loads each file only once.`,
  );
}

function sourceScope(
  editable: boolean,
  conditional: boolean,
): ContextReport["nodes"][number]["scope"] {
  if (!editable) return "host";
  return conditional ? "subdirectory" : "project";
}
async function resolveReference(
  candidate: string,
  root: string,
  home: string,
  findings: string[],
  label: string,
): Promise<
  | { kind: "resolved"; file: string; revision: string }
  | { kind: "missing" | "outside" | "unavailable" }
> {
  try {
    const physical = await realpath(candidate);
    if (within(root, physical) || within(home, physical)) {
      const info = await stat(physical);
      if (info.isFile())
        return {
          kind: "resolved",
          file: physical,
          revision: instructionDigest(
            JSON.stringify([info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs]),
          ),
        };
      return { kind: "unavailable" };
    }
    return { kind: "outside" };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    )
      return { kind: "missing" };
    findings.push(`Could not inspect the reference ${label}.`);
  }
  return { kind: "unavailable" };
}
