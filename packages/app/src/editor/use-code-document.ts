import type { CodeDiagnostic } from "@otto-code/protocol/messages";
import { useEffect, useRef } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useCodeDiagnostics, useLspDiagnosticsStore } from "@/stores/lsp-diagnostics-store";

/**
 * Keeps the daemon's mirror of this file in step with the editor, and reads back the
 * problems the language servers find in it.
 *
 * The mirror is what makes diagnostics live. Before this, the buffer reached the daemon only
 * on the way into a definition or hover request - so a file could be broken for as long as
 * you avoided pointing at it. Syncing on every change means the servers re-lint as you type,
 * which is the behaviour the whole feature is for.
 *
 * The text comes in already debounced: it is the buffer store's draft, written by the
 * editor's own 750ms doc-sync. There is deliberately no second debounce here - two
 * independent timers on the same signal is how a keystroke ends up mirrored twice.
 */

export interface UseCodeDocumentInput {
  serverId: string;
  /** Absolute workspace root. */
  workspaceRoot: string;
  /** The file as the tab knows it - workspace-relative, or absolute. */
  path: string;
  /**
   * Current buffer text, or null while the file is still loading. Null mirrors nothing:
   * sending `""` for a file we have not read yet would have the servers lint an empty
   * document and publish problems that exist only because we lied about the contents.
   */
  text: string | null;
  /** Whether the host can answer `code.document.sync`. False does nothing at all. */
  enabled: boolean;
}

/**
 * The text to mirror for a buffer that may not have loaded yet - the draft while dirty,
 * otherwise what is on disk.
 *
 * Lives here rather than at the call site so the file pane's already-large view function
 * does not grow another three operators.
 */
export function mirrorableText(
  buffer: { draft: string | null; baseline: { content: string } | null } | null,
): string | null {
  if (buffer?.baseline == null) {
    return null;
  }
  return buffer.draft ?? buffer.baseline.content;
}

/**
 * The path the daemon will echo diagnostics under.
 *
 * The daemon resolves a relative request path against the workspace root and then addresses
 * everything by that absolute result, so the client has to predict the same string to match
 * a push to a tab. Cheap to do here and deterministic; the alternative - having the daemon
 * echo the requested spelling back - would put a client concern in the protocol.
 */
export function resolveDocumentPath(workspaceRoot: string, path: string): string {
  const isAbsolute = path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
  if (isAbsolute) {
    return path;
  }
  const root = workspaceRoot.replace(/[\\/]+$/, "");
  return `${root}/${path.replace(/^[\\/]+/, "")}`;
}

export function useCodeDocument(input: UseCodeDocumentInput): readonly CodeDiagnostic[] {
  const { serverId, workspaceRoot, path, text, enabled } = input;
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const documentPath = resolveDocumentPath(workspaceRoot, path);
  const active = enabled && text !== null;
  const diagnostics = useCodeDiagnostics(serverId, active ? documentPath : null);

  // Read from a ref inside the mirror effect so a text change does not tear down and
  // re-run the close-on-unmount cleanup below.
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    const current = textRef.current;
    if (!active || client === null || current === null) {
      return;
    }
    void client.syncCodeDocument(workspaceRoot, path, current).catch(() => {
      // A failed mirror costs this document its diagnostics until the next keystroke.
      // Nothing to tell the user: they did not ask for this, and the next change retries.
    });
  }, [active, client, path, workspaceRoot, text]);

  // Closing on unmount is what keeps the daemon's mirror bounded to the tabs that are
  // actually open - and it releases the diagnostics store entry with it.
  useEffect(() => {
    if (!active || client === null) {
      return;
    }
    return () => {
      void client.closeCodeDocument(workspaceRoot, path).catch(() => {
        // The daemon drops the document when the workspace closes anyway.
      });
      useLspDiagnosticsStore.getState().clearDocument(serverId, documentPath);
    };
  }, [active, client, documentPath, path, serverId, workspaceRoot]);

  return diagnostics;
}
