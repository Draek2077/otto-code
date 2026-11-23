import { instructionDigest, instructionReferences } from "@getpaseo/plugin/server/otto-openai";
import type { ContextFinding, ContextReport } from "@getpaseo/plugin/otto/context-management";
import type { GraphSource } from "./graph.js";
import { nativeReferences, memoryIndexHead } from "./native-text.js";
import { claudeInstructionText } from "./native-comments.js";

interface FindingGraph {
  nodes: ContextReport["nodes"];
  edges: ContextReport["edges"];
  sources: Map<string, GraphSource>;
}
interface ContentBlock {
  start: number;
  end: number;
  normalized: string;
  exact: string;
  plain: boolean;
}
interface ContentFile {
  node: ContextReport["nodes"][number];
  source: GraphSource;
  blocks: ContentBlock[];
}
function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < Math.min(offset, text.length); index++)
    if (text.charCodeAt(index) === 10) line++;
  return line;
}
function blocks(source: GraphSource): ContentBlock[] {
  const offset = source.contextStart ?? 0;
  let text = source.text.slice(offset, offset + (source.contextLength ?? source.text.length));
  if (source.category === "memory_index") text = memoryIndexHead(text);
  if (source.nativeImports) text = claudeInstructionText(text, true);
  const result: ContentBlock[] = [];
  let cursor = 0;
  function append(end: number): void {
    const raw = text.slice(cursor, end);
    const trimmed = raw.trim();
    if (trimmed.replace(/\s+/gu, " ").length < 60) return;
    const start = offset + cursor + raw.length - raw.trimStart().length;
    const stop = start + trimmed.length;
    const exact = source.text.slice(start, stop).replace(/\s+/gu, " ").trim();
    result.push({
      start,
      end: stop,
      normalized: trimmed.replace(/\s+/gu, " ").toLowerCase(),
      exact,
      plain: !/(?:^|\n)(?:\s{0,3}[`~]{3,}| {4}|\t)|<!--/u.test(source.text.slice(start, stop)),
    });
  }
  for (const match of text.matchAll(/(^|\n)\s*\n/gu)) {
    append(match.index);
    cursor = match.index + match[0].length;
  }
  append(text.length);
  return result;
}
function reaches(
  edges: ContextReport["edges"],
  from: string,
  target: string,
  seen = new Set<string>(),
): boolean {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return edges.some(
    (edge) =>
      edge.kind === "import" &&
      edge.to !== null &&
      edge.from === from &&
      reaches(edges, edge.to, target, seen),
  );
}
type AddFinding = (
  file: ContentFile,
  kind: ContextFinding["kind"],
  start: number,
  end: number,
  message: string,
  fixable?: boolean,
  relatedNodeIds?: string[],
) => void;
function dependencyFindings(graph: FindingGraph, file: ContentFile, add: AddFinding): void {
  const references = file.source.native
    ? nativeReferences(file.source.text, file.source.nativeImports === true)
    : instructionReferences(file.source.text);
  for (const reference of references) {
    const id = instructionDigest(
      JSON.stringify([file.source.file, reference.start, reference.end]),
    );
    const edge = graph.edges.find((candidate) => candidate.id === id);
    if (!edge) continue;
    if (edge.resolution === "missing")
      add(
        file,
        edge.kind === "import" ? "dead_import" : "dead_reference",
        reference.start,
        reference.end,
        `The local target ${edge.target} is missing.`,
        true,
      );
    if (edge.resolution === "depth_capped")
      add(
        file,
        "depth_capped",
        reference.start,
        reference.end,
        "This dependency exceeds the provider's import depth limit. Review the dependency chain.",
      );
    if (edge.kind === "import" && edge.to && reaches(graph.edges, edge.to, edge.from))
      add(
        file,
        "import_cycle",
        reference.start,
        reference.end,
        "This dependency participates in an import cycle. Choose which relationship to change.",
        false,
        [edge.to],
      );
  }
}
/** Typed, bounded diagnostics. Unknown/excluded/outside targets are never guessed to be dead. */
export function collectContextFindings(graph: FindingGraph): ContextFinding[] {
  const result: ContextFinding[] = [];
  const files: ContentFile[] = graph.nodes.flatMap((node) => {
    const source = graph.sources.get(node.id);
    return source?.loaded && node.category !== "skills_roster"
      ? [{ node, source, blocks: blocks(source) }]
      : [];
  });
  function add(
    file: ContentFile,
    kind: ContextFinding["kind"],
    start: number,
    end: number,
    message: string,
    fixable = false,
    relatedNodeIds: string[] = [],
  ): void {
    if (result.length >= 256) return;
    const range = { start, end };
    const id = instructionDigest(
      JSON.stringify([kind, file.node.id, file.source.revision, range, relatedNodeIds]),
    );
    if (result.some((finding) => finding.id === id)) return;
    result.push({
      id,
      kind,
      nodeId: file.node.id,
      sourceRevision: file.source.revision,
      range,
      message,
      relatedNodeIds,
      fixable: fixable && file.source.editable,
      line: lineAt(file.source.text, start),
      lineEnd: lineAt(file.source.text, Math.max(start, end - 1)),
      snippet: file.source.text.slice(start, Math.min(end, start + 240)),
    });
  }
  for (const file of files) {
    dependencyFindings(graph, file, add);
    const first = new Map<string, ContentBlock>();
    for (const block of file.blocks) {
      const previous = first.get(block.normalized);
      if (previous)
        add(
          file,
          "duplicate_within_file",
          block.start,
          block.end,
          `Repeated content; keep the earlier copy at line ${lineAt(file.source.text, previous.start)}.`,
          block.plain && previous.plain && block.exact === previous.exact,
        );
      else first.set(block.normalized, block);
    }
    if (file.node.category === "memory_index") {
      let offset = 0;
      for (const line of memoryIndexHead(file.source.text).split(/(?<=\n)/u)) {
        if (line.trim().length > 200)
          add(
            file,
            "oversized_memory_entry",
            offset,
            offset + line.trimEnd().length,
            "The startup memory index entry exceeds one short line. Review moving detail to its referenced entry; no automatic deletion is safe.",
          );
        offset += line.length;
      }
    }
  }
  const byBlock = new Map<string, { file: ContentFile; block: ContentBlock }[]>();
  for (const file of files.filter((entry) => entry.node.costClass === "fixed"))
    for (const block of file.blocks) {
      const group = byBlock.get(block.normalized) ?? [];
      group.push({ file, block });
      byBlock.set(block.normalized, group);
    }
  for (const group of byBlock.values()) {
    if (new Set(group.map(({ file }) => file.node.scope)).size < 2) continue;
    // Retain global guidance. Deleting it would change unrelated projects on this host.
    const canonical = group.find(({ file }) => file.node.scope === "host") ?? group[0]!;
    for (const { file, block } of group)
      if (file.node.id !== canonical.file.node.id)
        add(
          file,
          "duplicate_across_scope",
          block.start,
          block.end,
          `Repeated across scopes; the copy in ${canonical.file.node.label} is retained. Review ordering and casing before removal.`,
          block.plain && canonical.block.plain && block.exact === canonical.block.exact,
          [canonical.file.node.id],
        );
  }
  return result;
}
