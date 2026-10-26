import path from "node:path";
import { expect, test } from "vitest";
import { instructionDigest, instructionReferences } from "@getpaseo/plugin/server/otto-openai";
import type { ContextReport } from "@getpaseo/plugin/otto/context-management";
import type { GraphSource } from "./graph.js";
import { collectContextFindings } from "./findings.js";
const rule =
  "Always preserve every unrelated user setting and keep all products compatible across updates.";
function source(
  name: string,
  text: string,
  options: {
    scope?: "host" | "project";
    category?: "context_files" | "memory_index";
    loaded?: boolean;
    conditional?: boolean;
    native?: boolean;
  } = {},
) {
  const file = path.resolve("finding-fixture", name),
    id = instructionDigest(file),
    revision = instructionDigest(text);
  const scope = options.scope ?? "project";
  const node: ContextReport["nodes"][number] = {
    id,
    label: name,
    revision,
    scope,
    category: options.category ?? "context_files",
    costClass: options.conditional ? "conditional" : "fixed",
    characters: text.length,
    estimatedTokens: Math.ceil(text.length / 4),
    editable: scope !== "host",
  };
  const value: GraphSource = {
    file,
    text,
    revision,
    scope: path.dirname(file),
    editable: node.editable,
    loaded: options.loaded !== false,
    category: node.category,
    native: options.native,
    nativeImports: options.native,
  };
  return { node, value };
}
function graph(
  files: ReturnType<typeof source>[],
  resolutions: NonNullable<ContextReport["edges"][number]["resolution"]>[] = [],
) {
  const edges: ContextReport["edges"] = files.flatMap(({ value, node }) =>
    instructionReferences(value.text).map((reference, index) => ({
      id: instructionDigest(JSON.stringify([value.file, reference.start, reference.end])),
      from: node.id,
      to: null,
      kind: reference.kind,
      target: reference.target,
      resolution: resolutions[index] ?? "unavailable",
    })),
  );
  return {
    nodes: files.map((entry) => entry.node),
    sources: new Map(files.map((entry) => [entry.node.id, entry.value])),
    edges,
  };
}
test("within-file duplicates identify the later exact source span and retain the first copy", () => {
  const text = `🙂\r\n\r\n${rule}\r\n\r\n${rule}\r\n`;
  const file = source("AGENTS.md", text);
  const findings = collectContextFindings(graph([file]));
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({
    kind: "duplicate_within_file",
    nodeId: file.node.id,
    sourceRevision: file.node.revision,
    line: 5,
    lineEnd: 5,
    fixable: true,
  });
  expect(text.slice(findings[0]!.range.start, findings[0]!.range.end)).toBe(rule);
});
test("cross-scope duplicates retain global guidance and offer only the project copy for removal", () => {
  const global = source("global.md", rule, { scope: "host" });
  const project = source("project.md", rule);
  const findings = collectContextFindings(graph([project, global]));
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({
    kind: "duplicate_across_scope",
    nodeId: project.node.id,
    relatedNodeIds: [global.node.id],
    fixable: true,
  });
});
test("same-scope composition and short repeated headings are not diagnosed as cross-scope waste", () => {
  const a = source("a.md", `## Rules\n\n${rule}`),
    b = source("b.md", `## Rules\n\n${rule}`);
  expect(collectContextFindings(graph([a, b]))).toEqual([]);
});
test("case-sensitive variations stay diagnostic and never become mechanical deletion of a different rule", () => {
  const file = source("AGENTS.md", `${rule}\n\n${rule.toUpperCase()}`);
  expect(collectContextFindings(graph([file]))).toMatchObject([
    { kind: "duplicate_within_file", fixable: false },
  ]);
});
test("repeated fenced examples require review rather than mechanical deletion", () => {
  const block = `\`\`\`md\n${rule}\n\`\`\``;
  const file = source("AGENTS.md", `${block}\n\n${block}`);
  expect(collectContextFindings(graph([file]))).toMatchObject([
    { kind: "duplicate_within_file", fixable: false },
  ]);
});
test("dead targets require a proven missing resolution; outside, unknown and excluded targets are preserved", () => {
  const file = source(
    "AGENTS.md",
    "@dead.md\n[Dead](gone.md)\n[Outside](../other.md)\n[Unknown](unknown.md)\n[Excluded](excluded.md)",
  );
  const findings = collectContextFindings(
    graph([file], ["missing", "missing", "outside", "unavailable", "excluded"]),
  );
  expect(findings.map((finding) => finding.kind)).toEqual(["dead_import", "dead_reference"]);
  expect(findings.every((finding) => finding.fixable)).toBe(true);
  expect(findings.map((finding) => finding.line)).toEqual([1, 2]);
});
test("cycles and capped depth identify their own source edge and do not invent a deletion choice", () => {
  const a = source("a.md", "@b.md"),
    b = source("b.md", "@a.md");
  const current = graph([a, b], ["resolved"]);
  current.edges[0]!.to = b.node.id;
  current.edges[1]!.to = a.node.id;
  expect(
    collectContextFindings(current).map((finding) => [
      finding.kind,
      finding.nodeId,
      finding.fixable,
    ]),
  ).toEqual([
    ["import_cycle", a.node.id, false],
    ["import_cycle", b.node.id, false],
  ]);
  const capped = graph([a], ["depth_capped"]);
  expect(collectContextFindings(capped)).toMatchObject([
    { kind: "depth_capped", nodeId: a.node.id, fixable: false },
  ]);
});
test("oversized memory findings inspect only the startup head and never apply to ordinary prose", () => {
  const long = "detail ".repeat(40);
  const memory = source("MEMORY.md", long + "\n" + "short\n".repeat(199) + long, {
    category: "memory_index",
  });
  const prose = source("AGENTS.md", long);
  expect(collectContextFindings(graph([memory, prose]))).toMatchObject([
    { kind: "oversized_memory_entry", line: 1, nodeId: memory.node.id, fixable: false },
  ]);
});
test("unread linked bodies and conditional sources are not counted as cross-scope fixed duplicates", () => {
  const global = source("global.md", rule, { scope: "host" });
  const linked = source("linked.md", `${rule}\n\n${rule}`, { loaded: false });
  const conditional = source("conditional.md", rule, { conditional: true });
  expect(collectContextFindings(graph([global, linked, conditional]))).toEqual([]);
});
test("Claude comments do not create content findings or missing-import fixes", () => {
  const file = source("CLAUDE.md", `<!--\n${rule}\n\n${rule}\n@commented.md\n-->\n${rule}`, {
    native: true,
  });
  expect(collectContextFindings(graph([file], ["missing"]))).toEqual([]);
});
test("diagnostics are bounded and snippets never copy entire large documents into the report", () => {
  const file = source("AGENTS.md", Array.from({ length: 400 }, () => rule).join("\n\n"));
  const findings = collectContextFindings(graph([file]));
  expect(findings).toHaveLength(256);
  expect(findings.every((finding) => finding.snippet.length <= 240)).toBe(true);
});
