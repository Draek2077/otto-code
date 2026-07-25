import { useCallback, useRef, type RefObject } from "react";
import { useSessionStore } from "@/stores/session-store";
import type { EditorController, EditorHoverAnswer } from "./editor-contract";

export interface UseCodeHoverInput {
  serverId: string;
  workspaceRoot: string;
  /** The file the editor is showing; may be workspace-relative or absolute. */
  path: string;
  controllerRef: RefObject<EditorController | null>;
  /** Whether the host can answer `code.hover`. False returns no provider at all. */
  enabled: boolean;
}

/**
 * Hover explanations from the language server, shaped for the editor core's tooltip.
 *
 * The buffer is mirrored before asking, exactly as go-to-definition does, so the
 * explanation accounts for unsaved edits rather than describing what is on disk — but
 * only when the buffer actually changed since the last ask. A hover fires on every
 * pointer rest, and re-shipping the whole document each time is the single largest
 * cost on the warm path, especially over the relay.
 *
 * The four answers are kept apart rather than collapsed to "markdown or nothing",
 * because the tooltip does something different with each: `content` fills in, `none`
 * retracts, and `warming` holds the tooltip open and asks again. Collapsing them is
 * what made a cold editor show nothing at all — indistinguishable from resting the
 * pointer on a comma.
 *
 * Returns `undefined` when disabled, because the editor core treats an absent provider
 * as "do not install the hover extension at all".
 */
export function useCodeHover(
  input: UseCodeHoverInput,
): ((position: { line: number; column: number }) => Promise<EditorHoverAnswer>) | undefined {
  const { serverId, workspaceRoot, path, controllerRef, enabled } = input;
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  // What the daemon's mirror was last told, per file. Not state: nothing renders from
  // it, and a re-render between the sync and the ask would be a correctness hazard.
  // The client is part of the key because a reconnect gets a fresh daemon-side mirror,
  // and the memo is dropped on any non-answer so a lost mirror re-syncs on the retry
  // rather than staying wrong for the life of the tab.
  const syncedRef = useRef<{ client: unknown; path: string; text: string } | null>(null);

  const resolveHover = useCallback(
    async (position: { line: number; column: number }): Promise<EditorHoverAnswer> => {
      const controller = controllerRef.current;
      if (!client || !controller) {
        return { kind: "unavailable" };
      }
      try {
        const text = await controller.getDoc();
        const synced = syncedRef.current;
        if (
          synced === null ||
          synced.client !== client ||
          synced.path !== path ||
          synced.text !== text
        ) {
          await client.syncCodeDocument(workspaceRoot, path, text);
          syncedRef.current = { client, path, text };
        }
        const result = await client.getCodeHover({
          cwd: workspaceRoot,
          path,
          line: position.line,
          column: position.column,
        });
        if (result.status === "indexing") {
          return { kind: "warming" };
        }
        if (result.status !== "ok") {
          syncedRef.current = null;
          return { kind: "unavailable" };
        }
        const markdown = result.markdown;
        return markdown !== null && markdown.trim().length > 0
          ? { kind: "content", markdown }
          : { kind: "none" };
      } catch {
        syncedRef.current = null;
        return { kind: "unavailable" };
      }
    },
    [client, controllerRef, path, workspaceRoot],
  );

  return enabled ? resolveHover : undefined;
}
