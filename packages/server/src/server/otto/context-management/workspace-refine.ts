import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { instructionDigest, instructionReferences } from "@getpaseo/plugin/server/otto-openai";
import { within } from "./graph.js";
import { isRefinableDocument } from "./refine-scope.js";
import type { ContextFileTarget } from "./source-file.js";
import { readContextSource } from "./source-read.js";

const hiddenPath = (relative: string) =>
  relative.split(path.sep).some((part) => part.startsWith(".") || part === "node_modules");

async function targetForFile(root: string, id: string): Promise<ContextFileTarget> {
  if (id.length > 4096) throw new Error("A selected document path is too long.");
  const file = path.resolve(root, id);
  if (file === root || !within(root, file) || hiddenPath(path.relative(root, file))) {
    throw new Error("Choose visible files inside the selected workspace.");
  }
  if ((await realpath(file)) !== file)
    throw new Error("Refine cannot follow linked files or directories.");
  const info = await lstat(file);
  if (!info.isFile() || info.nlink !== 1 || info.size > 131072) {
    throw new Error("Refine needs ordinary text files within the 128 KiB source limit.");
  }
  const editable = isRefinableDocument(file);
  return {
    home: root,
    root,
    refine: true,
    source: { file, editable, loaded: false, text: "", scope: "project", revision: "" },
    node: {
      id,
      label: path.relative(root, file),
      revision: "",
      scope: "project",
      costClass: "referenced",
      characters: 0,
      estimatedTokens: 0,
      editable,
    },
  };
}

/** Every call re-resolves the authorized workspace tree. A prior discovery
 * result or a client-supplied path cannot authorize a write outside it. */
export async function workspaceRefineTargets(root: string, ids: string[]) {
  if (ids.length > 36) throw new Error("Choose at most 36 files or reference candidates.");
  const targets = new Map<string, ContextFileTarget>();
  const resolved = new Set<string>();
  for (const id of new Set(ids)) {
    const target = await targetForFile(root, id);
    if (resolved.has(target.source.file)) throw new Error("Choose each file only once.");
    targets.set(id, target);
    resolved.add(target.source.file);
  }
  return { root, targets };
}

export async function discoverRefineFiles(root: string, files: string[]) {
  const { targets } = await workspaceRefineTargets(root, files);
  const nodes = [...targets.values()].map((target) => target.node);
  if (nodes.some((node) => !node.editable)) {
    throw new Error(
      "Choose prose documents to refine. Other text may be used as read-only references.",
    );
  }
  const discovered = new Set([...targets.values()].map((target) => target.source.file));
  let attempts = 0;
  for (const target of targets.values()) {
    const text = await readContextSource(target.source.file);
    target.node.revision = instructionDigest(text);
    target.node.characters = text.length;
    for (const reference of instructionReferences(text)) {
      if (attempts >= 48 || nodes.length >= 36) break;
      attempts += 1;
      const candidate = path.resolve(path.dirname(target.source.file), reference.target);
      if (discovered.has(candidate)) continue;
      discovered.add(candidate);
      const link = await targetForFile(root, candidate).catch(() => null);
      if (link) nodes.push(link.node);
    }
  }
  return { nodes, selectedId: nodes[0]!.id };
}
