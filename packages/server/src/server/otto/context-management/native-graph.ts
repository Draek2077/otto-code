import path from "node:path";
import { instructionDigest, instructionReferences } from "@getpaseo/plugin/server/otto-openai";
import type { ContextReport, ContextCategory } from "@getpaseo/plugin/otto/context-management";
import { within, type GraphSource, type GraphEdge } from "./graph.js";
import type { NativeContextInventory } from "./native-inventory.js";

export function nativeContextGraph(inventory: NativeContextInventory, root: string) {
  const sources = new Map<string, GraphSource>();
  const edits = new Map<string, GraphEdge>();
  const sections: Partial<Record<ContextCategory, string>> = {};
  const nodes: ContextReport["nodes"] = inventory.entries.map((entry) => {
    const id = instructionDigest(entry.file);
    const editable = within(root, entry.file);
    sources.set(id, {
      ...entry,
      scope: path.dirname(entry.file),
      loaded: entry.costClass !== "referenced" && entry.category !== "skills_roster",
      editable,
      native: true,
      nativeImports: entry.imports,
    });
    if (entry.costClass === "fixed")
      sections[entry.category] = [sections[entry.category], entry.countedText]
        .filter((value) => value !== undefined)
        .join("\n\n");
    return {
      id,
      label: entry.label,
      revision: entry.revision,
      scope: entry.scope,
      category: entry.category,
      costClass: entry.costClass,
      characters: entry.countedText.length,
      estimatedTokens: Math.ceil(entry.countedText.length / 4),
      editable,
    };
  });
  const edges: ContextReport["edges"] = inventory.dependencies.map((dependency) => {
    const id = instructionDigest(
      JSON.stringify([dependency.file, dependency.start, dependency.end]),
    );
    const source = inventory.entries.find((entry) => entry.file === dependency.file)!;
    // The existing span writer supports literal Markdown syntax. Unsupported native syntax remains inspectable, never rewritten by guessing.
    const convertible =
      source.imports &&
      within(root, source.file) &&
      instructionReferences(source.text).some(
        (entry) => entry.start === dependency.start && entry.end === dependency.end,
      );
    if (convertible) edits.set(id, dependency);
    return {
      id,
      from: instructionDigest(dependency.file),
      to: dependency.resolved ? instructionDigest(dependency.resolved) : null,
      target: dependency.target,
      kind: dependency.kind,
      editable: convertible,
      resolution: dependency.resolution,
    };
  });
  for (const category of ["context_files", "memory_index", "skills_roster"] as const)
    sections[category] ??= "";
  return { sources, edits, nodes, edges, findings: inventory.notes, sections };
}
