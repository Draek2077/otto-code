import { dirname, join } from "node:path";
import { lstatSync, readFileSync } from "node:fs";
import { z } from "zod";
import { getPaseoWorktreeMetadataPath } from "../../../utils/worktree-metadata.js";
import { writePrivateFileAtomicSync } from "../../private-files.js";

// Keep Otto 0.9's branch-keyed record: a plain checkout shares its gitdir across branches.
const Document = z
  .object({
    version: z.literal(1),
    byBranch: z.record(
      z.string(),
      z.object({ ref: z.string().min(1), source: z.enum(["user", "inferred"]) }).passthrough(),
    ),
  })
  .passthrough();
function file(root: string) {
  return join(dirname(getPaseoWorktreeMetadataPath(root)), "diff-base.json");
}
function read(root: string) {
  const target = file(root);
  try {
    const info = lstatSync(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024)
      throw new Error("The saved comparison branches could not be read.");
    return Document.parse(JSON.parse(readFileSync(target, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { version: 1 as const, byBranch: {} };
    throw error;
  }
}
export function readComparisonBase(root: string, branch: string | null): string | null {
  if (!branch) return null;
  return read(root).byBranch[branch]?.ref ?? null;
}
export function writeComparisonBase(root: string, branch: string, ref: string) {
  const current = read(root);
  writePrivateFileAtomicSync(
    file(root),
    JSON.stringify(
      {
        ...current,
        byBranch: {
          ...current.byBranch,
          [branch]: { ...current.byBranch[branch], ref, source: "user" },
        },
      },
      null,
      2,
    ) + "\n",
  );
}
