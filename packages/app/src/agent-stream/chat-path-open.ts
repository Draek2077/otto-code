import { normalizeInlinePathTarget, type InlinePathTarget } from "@/assistant-file-links/parse";
import {
  normalizeWorkspaceFileLocation,
  type OpenFileDisposition,
  type WorkspaceFileOpenRequest,
} from "@/workspace/file-open";

/** Keep an absolute chat link rooted until the file opener selects its serving workspace. */
export function resolveChatPathOpen(
  target: InlinePathTarget,
  disposition: OpenFileDisposition,
  paneWorkspaceRoot: string | null,
): WorkspaceFileOpenRequest | null {
  const normalized = normalizeInlinePathTarget(target.path, paneWorkspaceRoot ?? undefined);
  if (!normalized?.file) return null;

  const location = normalizeWorkspaceFileLocation({
    path: normalized.file,
    lineStart: target.lineStart,
    lineEnd: target.lineEnd,
  });

  return location ? { location, disposition } : null;
}
