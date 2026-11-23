import {
  classifyForResolution,
  fetchDaemonResolution,
  type GetDirectorySuggestions,
  UnresolvedFileLinkError,
} from "@/assistant-file-links/resolver";
import { normalizeInlinePathTarget } from "@/assistant-file-links/parse";
import { resolveInlinePathOpen } from "@/assistant-file-links/path-open";
import {
  normalizeWorkspaceFileLocation,
  type OpenFileDisposition,
  type WorkspaceFileOpenRequest,
} from "@/workspace/file-open";
import type {
  TerminalLocalFileLinkSource,
  TerminalLocalFileLinkTarget,
} from "@/terminal/local-links/terminal-local-link-provider";

export interface TerminalPathClient {
  listDirectory(root: string, path: string): Promise<unknown>;
  getDirectorySuggestions: GetDirectorySuggestions;
}
/** Hover is purely lexical. Filesystem and fuzzy resolution happen only on activation. */
export function terminalLinkCandidate(
  source: TerminalLocalFileLinkSource,
  root: string,
): TerminalLocalFileLinkTarget | null {
  const resolution = classifyForResolution(
    { href: source.text, text: source.text, sourceType: "inline-code" },
    { workspaceRoot: root },
  );
  if (resolution.kind === "needsLookup") return resolution.target;
  return resolution.value.kind === "file" ? resolution.value.target : null;
}
export function createTerminalPathOpener(input: {
  root: string;
  client: TerminalPathClient | null;
  openFile(request: WorkspaceFileOpenRequest): void;
  openDirectory(path: string): void;
}) {
  let generation = 0;
  return {
    cancel() {
      generation++;
    },
    async open(target: TerminalLocalFileLinkTarget, disposition: OpenFileDisposition) {
      const current = ++generation;
      const normalized = normalizeInlinePathTarget(target.path, input.root);
      if (!normalized) throw new UnresolvedFileLinkError(target.path);
      const destination = await resolveInlinePathOpen({
        ...normalized,
        lineStart: target.lineStart,
        workspaceRoot: input.root,
        client: input.client,
      });
      if (current !== generation) return;
      if (destination.kind === "directory") {
        input.openDirectory(destination.directoryPath);
        return;
      }
      const resolution = classifyForResolution(
        { href: target.path, text: target.path, sourceType: "inline-code" },
        { workspaceRoot: input.root },
      );
      let resolved = target;
      if (resolution.kind === "needsLookup") {
        const client = input.client;
        if (!client) throw new UnresolvedFileLinkError(target.path);
        resolved = await fetchDaemonResolution({
          ...resolution,
          workspaceRoot: input.root,
          getDirectorySuggestions: (request) => client.getDirectorySuggestions(request),
        });
        resolved = { ...resolved, lineStart: target.lineStart, lineEnd: target.lineEnd };
      }
      if (current !== generation) return;
      const location = normalizeWorkspaceFileLocation(resolved);
      if (!location) throw new UnresolvedFileLinkError(target.path);
      input.openFile({ location, disposition });
    },
  };
}
