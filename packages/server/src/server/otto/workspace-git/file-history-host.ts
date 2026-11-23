import path from "node:path";
import {
  listFileRevisions,
  readFileRevisionDiff,
  readFileOrigin,
  readFileBlame,
} from "@getpaseo/plugin/otto/workspace-git";
import type { WorkspaceRegistry } from "../../workspace-registry.js";
import { parseDiff, highlightDiffWithFileContent } from "../../utils/diff-highlighter.js";
import {
  assertRepoRelativeFilePath,
  getFileHistory,
  getFileCommitDiff,
  getFileOriginCommit,
  getFileBlame,
} from "./file-history.js";

export function fileHistoryHost(deps: {
  serverId(): string;
  workspaces: Pick<WorkspaceRegistry, "get">;
}) {
  async function scope(input: { hostId: string; workspaceId: string; file: string }) {
    if (input.hostId !== deps.serverId()) throw new Error("Choose the workspace's owning host.");
    const owner = await deps.workspaces.get(input.workspaceId);
    if (!owner || owner.archivedAt) throw new Error("The workspace is no longer available.");
    const file = path.isAbsolute(input.file) ? path.relative(owner.cwd, input.file) : input.file;
    const relative = file.replaceAll("\\", "/");
    assertRepoRelativeFilePath(relative);
    return { cwd: owner.cwd, path: relative };
  }

  return function invoke(method: string, value: unknown) {
    switch (method) {
      case listFileRevisions.name:
        return respond(async () => {
          const input = listFileRevisions.input.parse(value);
          const file = await scope(input);
          return getFileHistory(file.cwd, {
            ...file,
            ...input.range,
            offset: input.offset,
            limit: 40,
          });
        });
      case readFileRevisionDiff.name:
        return respond(async () => {
          const input = readFileRevisionDiff.input.parse(value);
          const file = await scope(input);
          const revision = await getFileCommitDiff(file.cwd, {
            sha: input.sha,
            path: input.revisionPath,
            includeStructuralSource: input.includeStructuralSource,
          });
          const status = revision.truncated ? "too_large" : patchStatus(revision.diff);
          const patch = status === "ok" ? parseDiff(revision.diff)[0] : undefined;
          // Git's blob-to-blob patch can use object IDs as its synthetic names.
          // The nominated historical path owns grammar selection and review identity.
          const parsed = patch
            ? await highlightDiffWithFileContent({ ...patch, path: input.revisionPath }, file.cwd, {
                oldFileContent: revision.beforeSource ?? null,
                newFileContent: revision.afterSource ?? null,
                includeStructuralSource: input.includeStructuralSource,
              })
            : null;
          const empty = { isNew: false, isDeleted: false, additions: 0, deletions: 0, hunks: [] };
          return {
            file: { ...(parsed ?? empty), path: input.revisionPath, status },
            previousSha: revision.previousSha,
          };
        });
      case readFileOrigin.name:
        return respond(async () => {
          const input = readFileOrigin.input.parse(value);
          const file = await scope(input);
          return getFileOriginCommit(file.cwd, { path: file.path });
        });
      case readFileBlame.name:
        return respond(async () => {
          const input = readFileBlame.input.parse(value);
          const file = await scope(input);
          return getFileBlame(file.cwd, {
            path: input.revisionPath ?? file.path,
            sha: input.sha,
            startLine: input.startLine,
            lineCount: 200,
          });
        });
      default:
        return undefined;
    }
  };
}

function patchStatus(text: string) {
  return /^(Binary files .* differ|GIT binary patch)$/m.test(text) ? "binary" : "ok";
}

async function respond<T>(execute: () => Promise<T>) {
  try {
    return { ok: true, value: await execute() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Git could not read the file history.";
    return { ok: false, error: { kind: "failed", message: message.slice(0, 1000) } };
  }
}
