import {
  OTTO_SCRIPT_GROUP_KEY,
  type WorkspaceScript,
  type WorkspaceScriptGroup,
} from "@/screens/workspace/workspace-script-group";

/**
 * Below this many total rows the menu is scannable, and a filter field is just
 * chrome in the way. This repo's own root `package.json` declares 103 scripts,
 * which is what the threshold exists for; a small project never sees it.
 */
export const SCRIPT_FILTER_MIN_ROWS = 12;

/**
 * How many recently-run Scripts the Recent group holds. Deliberately small: it
 * is a shortcut to the run you actually want, not a history log. Past a handful
 * of rows it stops being faster to scan than the filter.
 */
export const RECENT_SCRIPT_LIMIT = 5;

export const RECENT_SCRIPT_GROUP_KEY = "recent";

export interface ScriptMenuGroupView {
  key: string;
  /** `null` for the Otto and Recent groups, whose headers are translated. */
  label: string | null;
  /** Ordered, and filtered when a query is active. */
  scripts: WorkspaceScript[];
  isExpanded: boolean;
  /** Rows in this group before filtering, for the header's count. */
  totalCount: number;
  /** Header is inert: the group cannot be collapsed away. */
  isAlwaysExpanded: boolean;
}

export interface ScriptMenuView {
  groups: ScriptMenuGroupView[];
  /**
   * Headers are hidden only in the pre-discovery shape: one group, always
   * expanded. Any collapsible group *must* show its header, or its rows have
   * nothing to open them and the menu renders empty.
   */
  showGroupHeaders: boolean;
  showFilter: boolean;
  /** Rows the user is actually looking at. The measure of whether this works. */
  visibleRowCount: number;
  totalRowCount: number;
  hasNoMatches: boolean;
}

function matchesQuery(script: WorkspaceScript, needle: string): boolean {
  const label = (script.label ?? script.scriptName).toLowerCase();
  if (label.includes(needle)) {
    return true;
  }
  // Matching the command is what makes "vitest" find every test script, whatever
  // each project chose to name them.
  return (script.command ?? "").toLowerCase().includes(needle);
}

/**
 * Recently-run first, then the order the daemon replied in.
 *
 * Applied to discovered groups only. Otto's group is hand-authored in
 * `otto.json` and small, so its declared order is a deliberate statement and
 * reordering it would only break muscle memory.
 */
function orderByRecency(
  scripts: readonly WorkspaceScript[],
  lastRunAtByScriptName: Record<string, number>,
): WorkspaceScript[] {
  return [...scripts].sort((left, right) => {
    const leftRun = lastRunAtByScriptName[left.scriptName] ?? 0;
    const rightRun = lastRunAtByScriptName[right.scriptName] ?? 0;
    return rightRun - leftRun;
  });
}

/**
 * The Recent group: the discovered Scripts this user actually runs, lifted out
 * of their collapsed source group and shown expanded near the top.
 *
 * Without this, recency does nothing. Discovered groups are collapsed by
 * default, so ordering *inside* one only pays off after the user has already
 * expanded 98 rows - which is the problem, not the fix.
 *
 * Otto's declared Scripts are excluded on purpose: they are already expanded
 * and first, so lifting them here would show the same row twice on one screen.
 */
function buildRecentScripts(
  groups: readonly WorkspaceScriptGroup[],
  lastRunAtByScriptName: Record<string, number>,
): WorkspaceScript[] {
  const candidates: WorkspaceScript[] = [];
  for (const group of groups) {
    if (group.key === OTTO_SCRIPT_GROUP_KEY) {
      continue;
    }
    for (const script of group.scripts) {
      if ((lastRunAtByScriptName[script.scriptName] ?? 0) > 0) {
        candidates.push(script);
      }
    }
  }
  return orderByRecency(candidates, lastRunAtByScriptName).slice(0, RECENT_SCRIPT_LIMIT);
}

export function isScriptGroupExpandedByDefault(groupKey: string): boolean {
  // Otto's declared Scripts are the curated set and the answer most of the
  // time, so they are the one group that opens with the menu.
  return groupKey === OTTO_SCRIPT_GROUP_KEY;
}

/**
 * Turn the grouped Scripts into what the menu renders: collapse state, the
 * Recent shortcut, recency ordering, and filtering.
 *
 * Kept pure and separate from `groupWorkspaceScripts` so the discovery layer's
 * shape stays free to change without dragging menu behaviour with it.
 *
 * **Filtering and collapsing interact deliberately.** With a query active every
 * group that has a match renders expanded, groups with none are dropped, and
 * the Recent shortcut is withdrawn (an explicit search wants one flat answer,
 * not the same row offered twice). The user's stored collapse state is never
 * written during a search, so clearing the field restores exactly the menu they
 * had rather than leaving everything expanded.
 */
export function buildScriptMenuView(input: {
  groups: readonly WorkspaceScriptGroup[];
  query: string;
  expansionByGroupKey: Record<string, boolean>;
  lastRunAtByScriptName: Record<string, number>;
}): ScriptMenuView {
  const { groups, expansionByGroupKey, lastRunAtByScriptName } = input;
  const needle = input.query.trim().toLowerCase();
  const isSearching = needle.length > 0;
  const totalRowCount = groups.reduce((sum, group) => sum + group.scripts.length, 0);

  const views: ScriptMenuGroupView[] = [];

  if (!isSearching) {
    const recent = buildRecentScripts(groups, lastRunAtByScriptName);
    if (recent.length > 0) {
      views.push({
        key: RECENT_SCRIPT_GROUP_KEY,
        label: null,
        scripts: recent,
        isExpanded: true,
        totalCount: recent.length,
        isAlwaysExpanded: true,
      });
    }
  }

  for (const group of groups) {
    const isOtto = group.key === OTTO_SCRIPT_GROUP_KEY;
    const ordered = isOtto
      ? [...group.scripts]
      : orderByRecency(group.scripts, lastRunAtByScriptName);
    const scripts = isSearching
      ? ordered.filter((script) => matchesQuery(script, needle))
      : ordered;

    if (isSearching && scripts.length === 0) {
      continue;
    }

    const isExpanded = isSearching
      ? true
      : (expansionByGroupKey[group.key] ?? isScriptGroupExpandedByDefault(group.key));

    views.push({
      key: group.key,
      label: group.label,
      scripts,
      isExpanded,
      totalCount: group.scripts.length,
      // Otto's group is the curated answer; there is nothing to gain from
      // letting a user hide it and then wonder where their scripts went.
      isAlwaysExpanded: isOtto,
    });
  }

  const visibleRowCount = views.reduce(
    (sum, group) => sum + (group.isExpanded ? group.scripts.length : 0),
    0,
  );

  return {
    groups: views,
    showGroupHeaders: views.length > 1 || views.some((group) => !group.isAlwaysExpanded),
    showFilter: totalRowCount >= SCRIPT_FILTER_MIN_ROWS,
    visibleRowCount,
    totalRowCount,
    hasNoMatches: isSearching && views.length === 0,
  };
}
