import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";

export interface OpenRefineTabInput {
  serverId: string;
  workspaceId: string;
  /**
   * Absolute paths the rewrite may change. The first names the tab and is the
   * session's primary. This list is the job's blast radius: a file that is not
   * in it cannot be written, whatever the model proposes.
   */
  paths: string[];
  /**
   * Absolute paths the rewrite may read but never change. This is how a caller
   * says "understand this file in the context of the project" without handing
   * the project over to be edited.
   */
  references?: string[];
  /** Optional preset to seed the instruction with (see refine-presets.ts). */
  presetId?: string;
}

/**
 * Set the rewrite up as a job in its own tab.
 *
 * The tab is opened *beside* the file rather than over it, so the document the
 * proposal is about stays one click away while it is being reviewed — the same
 * reason references and rename are tabs. One tab per primary path: refining a
 * document a second time supersedes the first job, since the second request is
 * a fresh pin of the same file.
 */
export function openRefineTab(input: OpenRefineTabInput): boolean {
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  const paths = input.paths.filter((path) => path.trim().length > 0);
  if (!workspaceKey || paths.length === 0) {
    return false;
  }
  const references = (input.references ?? []).filter(
    (path) => path.trim().length > 0 && !paths.includes(path),
  );

  useWorkspaceLayoutStore.getState().openTabFocused(
    workspaceKey,
    {
      kind: "refine",
      paths,
      ...(references.length > 0 ? { references } : {}),
      ...(input.presetId ? { presetId: input.presetId } : {}),
    },
    { insertAfterFocusedTab: true },
  );
  return true;
}
