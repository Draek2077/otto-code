import { useCallback, useEffect, useRef, useState } from "react";
import type { ContextCategory, ContextPromptPreview } from "@otto-code/protocol/messages";
import { useSessionStore } from "@/stores/session-store";
import { useContextManagementEnabled } from "./use-context-report";

/**
 * Fetches one section of the assembled prompt for reading.
 *
 * Component state rather than the store, unlike the report: a section is the
 * verbatim text the model is handed, it is only ever on screen while the user is
 * looking at it, and caching prose to make reselecting a row marginally faster is
 * the wrong trade. The report stays cached because the composer warning needs it
 * whether or not the tab is open; this does not.
 */
export interface PromptPreviewQuery {
  preview: ContextPromptPreview | null;
  /** Nothing to show yet - distinct from "on screen but revalidating". */
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

export interface PromptPreviewOptions {
  provider?: string | undefined;
  windowTokens?: number | undefined;
  personalityId?: string | undefined;
  /** Assemble only this section; omitted means the whole prompt. */
  category?: ContextCategory | undefined;
}

export function usePromptPreview(
  serverId: string,
  workspaceId: string | null,
  options: PromptPreviewOptions = {},
): PromptPreviewQuery {
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const enabled = useContextManagementEnabled(serverId);
  const [preview, setPreview] = useState<ContextPromptPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const { provider, windowTokens, personalityId, category } = options;

  // A stale response must never overwrite a newer one: switching personality
  // fires a second request while the first is still in flight, and the slower
  // answer would otherwise win and show the wrong text.
  const requestSeq = useRef(0);

  useEffect(() => {
    if (!enabled || !client || !workspaceId) {
      setPreview(null);
      return;
    }
    const seq = ++requestSeq.current;
    // Drop the previous section before fetching the next. Every input here
    // changes *which* text is correct, so holding the old one while the new one
    // loads would show the wrong section under the right heading.
    setPreview(null);
    setIsLoading(true);
    setError(null);
    void (async () => {
      try {
        const payload = await client.requestContextPromptPreview({
          workspaceId,
          ...(provider ? { provider } : {}),
          ...(typeof windowTokens === "number" ? { windowTokens } : {}),
          ...(personalityId ? { personalityId } : {}),
          ...(category ? { category } : {}),
        });
        if (seq !== requestSeq.current) return;
        setPreview(payload.preview);
      } catch (cause) {
        if (seq !== requestSeq.current) return;
        // A failed assembly says so. The one outcome to avoid is an empty pane
        // that cannot be told apart from "this workspace loads nothing".
        setError(cause instanceof Error ? cause.message : String(cause));
        setPreview(null);
      } finally {
        if (seq === requestSeq.current) setIsLoading(false);
      }
    })();
  }, [enabled, client, workspaceId, provider, windowTokens, personalityId, category, nonce]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  return { preview, isLoading: isLoading && preview === null, error, refresh };
}
