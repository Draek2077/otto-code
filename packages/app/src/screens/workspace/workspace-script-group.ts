import type { WorkspaceScriptPayload } from "@otto-code/protocol/messages";

/**
 * The shape the Scripts menu groups by, with no React and no store behind it,
 * so both the grouping hook and the pure menu-view layer can depend on it
 * without depending on each other.
 */
export type WorkspaceScript = WorkspaceScriptPayload;

export interface WorkspaceScriptGroup {
  /** Stable list key. `OTTO_SCRIPT_GROUP_KEY` for the declared group. */
  key: string;
  /**
   * The group header, already assembled ("npm · package.json"). `null` for the
   * Otto group, whose header is a translated label the caller supplies.
   */
  label: string | null;
  scripts: WorkspaceScript[];
}

/** Scripts declared in `otto.json`, as opposed to discovered from project files. */
export const OTTO_SCRIPT_GROUP_KEY = "otto";
