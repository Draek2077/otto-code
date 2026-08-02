import { useFetchQuery } from "@/data/query";
import { useSessionStore } from "@/stores/session-store";
import { isMarkdownPath } from "./markdown/markdown-path";
import { useCodeIndexFeature } from "./use-code-index-feature";

/**
 * The workspace file list markdown link completion offers after `](`.
 *
 * `code.list_files` is the fuzzy finder's listing: gitignore-aware, already
 * gated on the code-index capability, and already the thing this app means by
 * "the files in this workspace". Without that capability the hook returns
 * nothing and completion simply never opens, which is the no-fallback rule the
 * feature contract asks for.
 */

// A stable identity, so a host without the capability does not hand the editor
// a fresh array every render and re-push it across the native bridge.
const NO_TARGETS: readonly string[] = [];

type MarkdownLinkTargetsQueryKey = readonly ["markdownLinkTargets", string, string];

export function useMarkdownLinkTargets(input: {
  serverId: string;
  workspaceRoot: string;
  path: string;
}): readonly string[] {
  const client = useSessionStore((state) => state.sessions[input.serverId]?.client ?? null);
  const hasCodeIndex = useCodeIndexFeature(input.serverId);
  // Only markdown files ask. Every other buffer would pay a workspace listing
  // for a completion source that is not mounted.
  const enabled = client !== null && hasCodeIndex && isMarkdownPath(input.path);

  const queryKey: MarkdownLinkTargetsQueryKey = [
    "markdownLinkTargets",
    input.serverId,
    input.workspaceRoot,
  ];

  const { data } = useFetchQuery({
    queryKey,
    enabled,
    // A workspace listing, so `list`: the shape keeps the previous files on
    // screen while a refetch runs instead of blanking the completion source.
    dataShape: "list",
    /**
     * Keyed by workspace rather than by file, so opening a second markdown
     * document in the same workspace reuses this. Fetch-class queries refetch
     * on mount regardless, which is what notices a file created since the last
     * listing; the stale window only stops several tabs opening at once from
     * each asking.
     */
    staleTimeMs: 5 * 60_000,
    queryFn: async (): Promise<readonly string[]> => {
      const payload = await client!.listCodeFiles(input.workspaceRoot);
      // An indexing error is not worth surfacing here: the feature is a
      // convenience over typing the path, and there is no UI it could report
      // into that would not be noise.
      return payload.error ? NO_TARGETS : payload.files;
    },
  });

  return data ?? NO_TARGETS;
}
