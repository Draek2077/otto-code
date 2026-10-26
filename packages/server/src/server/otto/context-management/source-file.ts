import path from "node:path";
import { lstat } from "node:fs/promises";
import { instructionDigest } from "@getpaseo/plugin/server/otto-openai";
import type { ContextReport, ContextSourceFile } from "@getpaseo/plugin/otto/context-management";
import { within, type GraphSource } from "./graph.js";
import { readContextSource } from "./source-read.js";
import { rewriteContextFile } from "./source-write.js";

export interface ContextFileTarget {
  root: string;
  home: string;
  source: GraphSource;
  node: ContextReport["nodes"][number];
}
/** Only a fresh daemon-owned graph may nominate a source. No caller-supplied filesystem path. */
function boundary(target: ContextFileTarget): void {
  if (
    !target.source.native &&
    !within(target.root, target.source.file) &&
    !within(target.home, target.source.file)
  )
    throw new Error("This source is outside the owning host boundary.");
}
export async function currentContextFile(target: ContextFileTarget): Promise<ContextSourceFile> {
  boundary(target);
  if (target.node.scope === "runtime")
    throw new Error("Runtime-owned input is not an editable source file.");
  // Always read the current file, even when the report describes a captured request.
  const text = await readContextSource(target.source.file);
  const info = await lstat(target.source.file);
  const writable = info.isFile() && !info.isSymbolicLink() && info.nlink === 1;
  return {
    nodeId: target.node.id,
    label: target.node.label,
    text,
    revision: instructionDigest(text),
    scope: target.node.scope,
    writable,
    readOnlyReason: writable ? null : "Source edits require one ordinary file without links.",
  };
}
export async function saveCurrentContextFile(
  target: ContextFileTarget,
  input: {
    expectedRevision: string;
    text: string;
    userApprovedSave: boolean;
    userApprovedGlobal: boolean;
  },
): Promise<{ changed: boolean; revision: string }> {
  boundary(target);
  if (target.node.scope === "runtime")
    throw new Error("Runtime-owned input is not an editable source file.");
  if (!input.userApprovedSave)
    throw new Error("Review and explicitly approve the source change first.");
  if (target.node.scope === "host" && !input.userApprovedGlobal)
    throw new Error(
      "This host-wide source can affect other projects. Explicitly approve that scope before saving.",
    );
  return {
    revision: instructionDigest(input.text),
    changed: await rewriteContextFile({
      // A native/global catalog entry was nominated by the daemon, not by a client path.
      root: target.node.scope === "host" ? path.dirname(target.source.file) : target.root,
      file: target.source.file,
      expectedRevision: input.expectedRevision,
      rewrite: () => input.text,
    }),
  };
}
