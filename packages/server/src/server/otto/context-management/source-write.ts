import { withContextCleanup } from "./cleanup.js";
import { randomUUID } from "node:crypto";
import { open, rename, lstat, unlink, realpath } from "node:fs/promises";
import { readContextSource } from "./source-read.js";
import { instructionDigest } from "@getpaseo/plugin/server/otto-openai";
import { within, type GraphEdge } from "./graph.js";

export class ContextConflict extends Error {}
export class ContextBusy extends Error {}
/** Explicit single-span edit. Unknown source content, line endings and permissions survive. */
export async function changeInstructionEdge(input: {
  root: string;
  edge: GraphEdge;
  expectedRevision: string;
  mode: "import" | "reference";
}): Promise<boolean> {
  const { edge } = input;
  if (edge.kind === input.mode) return false;
  const file = await realpath(edge.file);
  if (file !== edge.file || !within(input.root, file))
    throw new Error("Only files in the selected workspace may be changed.");
  const lock = `${file}.otto-context-lock`;
  let handle;
  try {
    handle = await open(lock, "wx", 0o600);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST")
      throw new ContextBusy(
        "Another context edit is active. Inspect the writer before recovering its lock.",
        { cause: error },
      );
    throw error;
  }
  const temporary = `${file}.otto-context-${randomUUID()}`;
  return withContextCleanup(
    async () => {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 131072)
        throw new Error("Context edits require one ordinary source file.");
      const before = await readContextSource(file);
      if (instructionDigest(before) !== input.expectedRevision)
        throw new ContextConflict("The source changed. Refresh and review it before trying again.");
      const span = before.slice(edge.start, edge.end);
      const expected = edge.kind === "import" ? `@${edge.target}` : null;
      if (expected !== null && span !== expected)
        throw new ContextConflict(
          "The selected import is no longer at its reviewed source location.",
        );
      const replacement =
        input.mode === "import" ? `@${edge.target}` : `[${edge.target}](${edge.target})`;
      const after = before.slice(0, edge.start) + replacement + before.slice(edge.end);
      const staged = await open(temporary, "wx", info.mode);
      await withContextCleanup(
        async () => {
          await staged.writeFile(after, "utf8");
          await staged.chmod(info.mode & 0o777);
          await staged.sync();
        },
        () => staged.close(),
      );
      if (
        (await realpath(edge.file)) !== file ||
        instructionDigest(await readContextSource(file)) !== input.expectedRevision
      )
        throw new ContextConflict(
          "The source changed during this edit. Its current content was preserved.",
        );
      await rename(temporary, file);
      return true;
    },
    () =>
      withContextCleanup(
        () => handle.close(),
        () =>
          withContextCleanup(
            () => unlinkTemporary(temporary),
            () => unlink(lock),
          ),
      ),
  );
}

async function unlinkTemporary(file: string): Promise<void> {
  try {
    await unlink(file);
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT")
      throw error;
  }
}
