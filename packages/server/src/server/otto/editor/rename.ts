import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type { EditorPlan, EditorEditOutcome } from "@getpaseo/plugin/otto/editor";
import { readExplorerFile, writeExplorerFile } from "../../file-explorer/service.js";
import { EditorError } from "./errors.js";
import { WorkspaceEdit, TextEdit } from "./lsp/schema.js";
import { canonicalDocument, pathKey, uriPath } from "./lsp/uri.js";

interface StoredPlan {
  clientId: string;
  plan: EditorPlan;
  createdAt: number;
}
interface StoredRun {
  clientId: string;
  root: string;
  files: EditorPlan["files"];
  createdAt: number;
}
type Edit = z.infer<typeof TextEdit>;
interface RenameRequest {
  clientId: string;
  root: string;
  value: unknown;
  origin: { file: string; text: string };
}

function offset(text: string, position: Edit["range"]["start"]) {
  const breaks = /\r\n|\r|\n/gu;
  let line = 0;
  let from = 0;
  while (line < position.line) {
    const next = breaks.exec(text);
    if (!next) throw new EditorError("invalid", "Rename range is outside the source file.");
    from = breaks.lastIndex;
    line++;
  }
  const end = breaks.exec(text)?.index ?? text.length;
  if (position.character > end - from)
    throw new EditorError("invalid", "Rename column is outside the source line.");
  return from + position.character;
}
export function applyTextEdits(text: string, edits: readonly Edit[]): string {
  const ranges = edits.map((edit) => ({
    from: offset(text, edit.range.start),
    to: offset(text, edit.range.end),
    text: edit.newText,
  }));
  ranges.sort((a, b) => b.from - a.from || b.to - a.to);
  let previousStart = text.length + 1;
  let result = text;
  for (const range of ranges) {
    if (range.from > range.to || range.to > previousStart)
      throw new EditorError("invalid", "Language server returned overlapping rename edits.");
    result = result.slice(0, range.from) + range.text + result.slice(range.to);
    previousStart = range.from;
  }
  return result;
}

async function source(root: string, file: string) {
  const canonical = await canonicalDocument(root, file);
  const read = await readExplorerFile({
    root: canonical.root,
    relativePath: path.relative(canonical.root, canonical.file),
  });
  if (read.kind !== "text" || read.content === undefined || read.size > 1024 * 1024)
    throw new EditorError("invalid", "Rename supports UTF-8 source files up to 1 MB.");
  return { ...read, content: read.content, file: canonical.file };
}

/** Reviewed plans are host-owned and bounded. Apply accepts only a plan ID;
 * undo restores only files still holding exactly this run's after-image. */
export class EditorRenames {
  private readonly plans = new Map<string, StoredPlan>();
  private readonly runs = new Map<string, StoredRun>();
  private work: Promise<void> = Promise.resolve();
  constructor(
    private readonly drafts: (root: string, file: string) => readonly string[],
    private readonly writer: typeof writeExplorerFile = writeExplorerFile,
    private readonly guarded: (root: string, file: string) => boolean = () => false,
  ) {}
  private prune() {
    const threshold = Date.now() - 15 * 60000;
    for (const [id, value] of this.plans) if (value.createdAt < threshold) this.plans.delete(id);
    for (const [id, value] of this.runs) if (value.createdAt < threshold) this.runs.delete(id);
    while (this.plans.size >= 8) {
      const oldest = this.plans.keys().next().value;
      if (oldest) this.plans.delete(oldest);
    }
    while (this.runs.size >= 8) {
      const oldest = this.runs.keys().next().value;
      if (oldest) this.runs.delete(oldest);
    }
  }
  async plan({ clientId, root, value, origin }: RenameRequest): Promise<EditorPlan> {
    this.prune();
    const original = await source(root, origin.file);
    if (original.content.replace(/^\uFEFF/u, "") !== origin.text)
      throw new EditorError(
        "conflict",
        "The source changed while rename was being planned. Save and review again.",
      );
    const edit = WorkspaceEdit.parse(value);
    if (!edit)
      throw new EditorError("unavailable", "The language server cannot rename this symbol.");
    const entries = new Map<string, Edit[]>();
    for (const [uri, edits] of Object.entries(edit.changes ?? {})) entries.set(uri, edits);
    for (const change of edit.documentChanges ?? []) {
      const previous = entries.get(change.textDocument.uri) ?? [];
      entries.set(change.textDocument.uri, [...previous, ...change.edits]);
    }
    if (entries.size > 1000)
      throw new EditorError("invalid", "Rename affects too many files to review at once.");
    const files: EditorPlan["files"] = [];
    const seen = new Set<string>();
    let bytes = 0;
    for (const [uri, edits] of entries) {
      const read = await source(root, uriPath(uri));
      if (seen.has(pathKey(read.file)))
        throw new EditorError("invalid", "Language server returned duplicate file identities.");
      seen.add(pathKey(read.file));
      // Editors omit a UTF-8 BOM; rename preserves it without shifting LSP ranges.
      const bom = read.content.startsWith("\uFEFF") ? "\uFEFF" : "";
      const text = read.content.slice(bom.length);
      if (
        this.guarded(root, read.file) ||
        this.drafts(root, read.file).some((draft) => draft !== text)
      )
        throw new EditorError(
          "conflict",
          "Save or discard affected editor drafts before renaming.",
        );
      const after = bom + applyTextEdits(text, edits);
      bytes += Buffer.byteLength(read.content) + Buffer.byteLength(after);
      if (bytes > 8 * 1024 * 1024)
        throw new EditorError("invalid", "Rename preview exceeds the 8 MB review limit.");
      files.push({ file: read.file, before: read.content, after, editCount: edits.length });
    }
    return this.review(clientId, root, files);
  }
  async review(clientId: string, root: string, files: EditorPlan["files"]): Promise<EditorPlan> {
    this.prune();
    if (
      files.length > 1000 ||
      files.reduce(
        (size, file) => size + Buffer.byteLength(file.before) + Buffer.byteLength(file.after),
        0,
      ) >
        8 * 1024 * 1024
    )
      throw new EditorError("invalid", "The edit exceeds the review limit. Select fewer files.");
    for (const file of files) {
      const read = await source(root, file.file);
      if (
        read.content !== file.before ||
        this.guarded(root, read.file) ||
        this.drafts(root, read.file).some((draft) => draft !== file.before.replace(/^\uFEFF/u, ""))
      )
        throw new EditorError(
          "conflict",
          "A file or editor draft changed. Search or plan again before reviewing.",
        );
    }
    const plan: EditorPlan = { planId: randomUUID(), root, files };
    this.plans.set(plan.planId, { clientId, plan, createdAt: Date.now() });
    return plan;
  }
  apply(clientId: string, planId: string) {
    return this.serial(() => this.applyPlan(clientId, planId));
  }
  private async applyPlan(clientId: string, planId: string): Promise<EditorEditOutcome> {
    const stored = this.plans.get(planId);
    if (!stored || stored.clientId !== clientId || Date.now() - stored.createdAt > 15 * 60000)
      throw new EditorError("conflict", "Rename preview expired. Review a new plan.");
    this.plans.delete(planId);
    const outcome: EditorEditOutcome = { runId: randomUUID(), files: [] };
    const applied: EditorPlan["files"] = [];
    for (const file of stored.plan.files) {
      const result = await this.replace(stored.plan.root, file.file, file.before, file.after);
      outcome.files.push(result);
      if (result.state === "applied") applied.push(file);
    }
    this.prune();
    this.runs.set(outcome.runId, {
      clientId,
      root: stored.plan.root,
      files: applied,
      createdAt: Date.now(),
    });
    return outcome;
  }
  undo(clientId: string, runId: string) {
    return this.serial(async () => {
      const run = this.runs.get(runId);
      if (!run || run.clientId !== clientId || Date.now() - run.createdAt > 15 * 60000)
        throw new EditorError("conflict", "Rename undo expired.");
      const files: EditorEditOutcome["files"] = [];
      const remaining: EditorPlan["files"] = [];
      for (const file of run.files) {
        const result = await this.replace(run.root, file.file, file.after, file.before);
        if (result.state === "applied") files.push({ ...result, state: "restored" });
        else {
          files.push(result);
          remaining.push(file);
        }
      }
      run.files = remaining;
      return { runId, files };
    });
  }
  private async replace(
    root: string,
    file: string,
    expected: string,
    content: string,
  ): Promise<EditorEditOutcome["files"][number]> {
    try {
      const current = await source(root, file);
      const draftText = expected.replace(/^\uFEFF/u, "");
      const dirty =
        this.guarded(root, file) || this.drafts(root, file).some((draft) => draft !== draftText);
      if (current.content !== expected || dirty)
        return {
          file,
          state: "conflict",
          message: "The file or its editor draft changed since review; it was left unchanged.",
        };
      const result = await this.writer({
        root,
        relativePath: path.relative(root, file),
        content,
        expectedModifiedAt: current.modifiedAt,
        expectedRevision: current.revision,
      });
      if (result.status === "written") return { file, state: "applied", message: null };
      if (result.status === "conflict")
        return {
          file,
          state: "conflict",
          message: "The file changed during the operation; review it again.",
        };
      return this.reconcileWrite(root, file, content, result.error);
    } catch (error) {
      return this.reconcileWrite(
        root,
        file,
        content,
        error instanceof Error ? error.message : "The file could not be updated.",
      );
    }
  }
  private async reconcileWrite(
    root: string,
    file: string,
    content: string,
    failure: string,
  ): Promise<EditorEditOutcome["files"][number]> {
    try {
      const actual = await source(root, file);
      if (actual.content === content)
        return {
          file,
          state: "applied",
          message: `The intended content is present, but the write reported: ${failure}`,
        };
    } catch {
      /* The original operation error remains the actionable diagnostic. */
    }
    return { file, state: "failed", message: failure };
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.work.then(work);
    this.work = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  clear() {
    this.plans.clear();
    this.runs.clear();
  }
  async close() {
    await this.work;
    this.clear();
  }
}
