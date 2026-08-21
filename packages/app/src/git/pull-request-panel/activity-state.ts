import type { PrThreadEntry, PrTimelineEntry } from "./timeline";
import type { PrPaneActivity } from "./data";

export interface PullRequestActivityIdentity {
  prNumber: number;
  activityId: string;
}

export interface PullRequestActivityState {
  collapsedKeys: readonly string[];
  expandedKeys: readonly string[];
}

export interface VisiblePullRequestEntry {
  entry: PrTimelineEntry;
  collapsed: boolean;
}

export function getActivityState(): PullRequestActivityState {
  return { collapsedKeys: [], expandedKeys: [] };
}

export function getActivityStateKey(identity: PullRequestActivityIdentity): string {
  return `${identity.prNumber}:${identity.activityId}`;
}

/**
 * Whether the code an entry points at has moved on since the comment was
 * written - the "Outdated" badge on a thread header, and the `· outdated` in a
 * standalone comment's location line.
 *
 * A review entry is never outdated in itself: the review body has no position.
 * Its threads are judged one by one.
 */
export function isOutdatedEntry(entry: PrTimelineEntry): boolean {
  if (entry.kind === "thread") {
    return entry.location?.isOutdated === true;
  }
  if (entry.kind === "single") {
    return entry.activity.location?.isOutdated === true;
  }
  return false;
}

function shouldCollapseByDefault(entry: PrTimelineEntry): boolean {
  if (isOutdatedEntry(entry)) {
    return true;
  }
  if (entry.kind === "thread") {
    return entry.isResolved === true;
  }
  if (entry.kind === "single") {
    return entry.activity.location?.isResolved === true;
  }
  return false;
}

export function collapseActivity(
  state: PullRequestActivityState,
  identity: PullRequestActivityIdentity,
): PullRequestActivityState {
  const key = getActivityStateKey(identity);
  if (state.collapsedKeys.includes(key)) {
    return { ...state, expandedKeys: state.expandedKeys.filter((item) => item !== key) };
  }
  return {
    ...state,
    collapsedKeys: [...state.collapsedKeys, key],
    expandedKeys: state.expandedKeys.filter((item) => item !== key),
  };
}

export function expandActivity(
  state: PullRequestActivityState,
  identity: PullRequestActivityIdentity,
): PullRequestActivityState {
  const key = getActivityStateKey(identity);
  const collapsedKeys = state.collapsedKeys.filter((item) => item !== key);
  const expandedKeys = state.expandedKeys.includes(key)
    ? state.expandedKeys
    : [...state.expandedKeys, key];
  return { ...state, collapsedKeys, expandedKeys };
}

export function getVisibleEntries(
  state: PullRequestActivityState,
  input: { prNumber: number; entries: readonly PrTimelineEntry[] },
): VisiblePullRequestEntry[] {
  return input.entries.map((entry) => {
    const key = getActivityStateKey({ prNumber: input.prNumber, activityId: entry.id });
    const collapsedByDefault = shouldCollapseByDefault(entry);
    const isExplicitlyCollapsed = state.collapsedKeys.includes(key);
    const isExplicitlyExpanded = state.expandedKeys.includes(key);

    const collapsed = isExplicitlyCollapsed || (collapsedByDefault && !isExplicitlyExpanded);

    return { entry, collapsed };
  });
}

export function getCollapsedEntryIds(
  state: PullRequestActivityState,
  input: { prNumber: number; entries?: readonly PrTimelineEntry[] },
): ReadonlySet<string> {
  const prefix = `${input.prNumber}:`;
  const collapsedIds = new Set(
    state.collapsedKeys
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length)),
  );

  addDefaultCollapsedEntryIds(collapsedIds, state, input.prNumber, input.entries ?? []);

  return collapsedIds;
}

function addDefaultCollapsedEntryIds(
  collapsedIds: Set<string>,
  state: PullRequestActivityState,
  prNumber: number,
  entries: readonly PrTimelineEntry[],
) {
  for (const entry of entries) {
    const key = getActivityStateKey({ prNumber, activityId: entry.id });
    if (shouldCollapseByDefault(entry) && !state.expandedKeys.includes(key)) {
      collapsedIds.add(entry.id);
    }
    if (state.expandedKeys.includes(key)) {
      collapsedIds.delete(entry.id);
    }
    if (entry.kind === "review") {
      addDefaultCollapsedEntryIds(collapsedIds, state, prNumber, entry.threads);
    }
  }
}

/**
 * What "Add all to chat" attaches, resolved before anything is dispatched.
 *
 * Pure so the exclusions are testable: the loop that consumed this used to live
 * inline in the pane, where the only way to check which comments a bulk attach
 * skipped was to drive the UI.
 *
 * Two kinds are left out, both for the same reason - they would spend prompt
 * budget on advice the agent should not act on:
 *
 * - **Resolved** threads: someone already dealt with them.
 * - **Outdated** threads and comments: they point at a version of the file that
 *   no longer exists, so acting on them means editing code the reviewer was not
 *   looking at.
 *
 * Neither is hidden, only excluded from the bulk action. Both still carry their
 * own "Add to chat" on the card, so wanting one specifically is one click - the
 * judgement call stays with the user, and only the sweep is opinionated.
 */
export function selectBulkAttachTargets(entries: readonly VisiblePullRequestEntry[]): {
  activities: PrPaneActivity[];
  threads: PrThreadEntry[];
} {
  const activities: PrPaneActivity[] = [];
  const threads: PrThreadEntry[] = [];

  for (const { entry } of entries) {
    if (entry.kind === "single") {
      if (!isOutdatedEntry(entry)) {
        activities.push(entry.activity);
      }
      continue;
    }
    // The review body itself has no position, so it rides along whatever its
    // threads turn out to be - it is the reviewer's summary, and dropping it
    // because every thread under it went stale would lose the actual verdict.
    if (entry.kind === "review") {
      activities.push(entry.review);
    }
    for (const thread of entry.kind === "thread" ? [entry] : entry.threads) {
      if (thread.isResolved === true || isOutdatedEntry(thread)) {
        continue;
      }
      threads.push(thread);
    }
  }

  return { activities, threads };
}
