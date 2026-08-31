import { TIMELINE_FETCH_PAGE_SIZE } from "@/timeline/timeline-fetch-policy";

export interface TimelineSyncCursor {
  epoch: string;
  seq: number;
}

export interface AgentTimelineCursorRange {
  epoch: string;
  startSeq: number;
  endSeq: number;
}

export interface ProjectedTimelineTailFetchPlan {
  direction: "tail";
  limit: number;
  projection: "projected";
}

export interface ProjectedTimelineAfterFetchPlan {
  direction: "after";
  cursor: TimelineSyncCursor;
  limit: number;
  projection: "projected";
}

export interface ProjectedTimelineBeforeFetchPlan {
  direction: "before";
  cursor: TimelineSyncCursor;
  limit: number;
  projection: "projected";
}

export type ProjectedTimelineFetchPlan =
  | ProjectedTimelineTailFetchPlan
  | ProjectedTimelineAfterFetchPlan
  | ProjectedTimelineBeforeFetchPlan;

export type ProjectedTimelineForwardFetchPlan =
  | ProjectedTimelineTailFetchPlan
  | ProjectedTimelineAfterFetchPlan;

export function planInitialAgentTimelineSync(input: {
  cursor: AgentTimelineCursorRange | undefined;
  hasAuthoritativeHistory: boolean;
}): ProjectedTimelineForwardFetchPlan {
  if (input.hasAuthoritativeHistory && input.cursor) {
    return planTimelineCatchUpAfter({ epoch: input.cursor.epoch, seq: input.cursor.endSeq });
  }

  return planTimelineTailFetch();
}

/**
 * Whether focusing a chat pane needs a timeline round-trip at all.
 *
 * Focusing used to fetch unconditionally, which meant every workspace
 * round-trip re-issued `fetch_agent_timeline` for a transcript the client
 * already held - measured at 4 responses (~15 KiB) per round-trip with nothing
 * changed, and the largest single share of the navigation path's inbound
 * handler time. It is redundant while the connection has stayed up: live
 * `agent_stream` keeps the tail current, and the reducer's own seq/epoch gate
 * (`classifySessionTimelineSeq`) already requests a catch-up the moment it sees
 * a gap or an epoch change. So the only two cases that genuinely need a fetch
 * on focus are the ones this returns true for:
 *
 * - history was never applied for this agent (first open, or the last attempt
 *   failed and left the flag clear), and
 * - the host reconnected since this agent last synced, so pushes emitted while
 *   the socket was down are gone (`historySyncGeneration`).
 */
export function shouldSyncAgentTimelineOnFocus(input: {
  hasAuthoritativeHistory: boolean;
  needsAuthoritativeSync: boolean;
}): boolean {
  return !input.hasAuthoritativeHistory || input.needsAuthoritativeSync;
}

export function planResumeTimelineSync(input: {
  cursor: AgentTimelineCursorRange | undefined;
}): ProjectedTimelineForwardFetchPlan {
  if (input.cursor) {
    return planTimelineCatchUpAfter({ epoch: input.cursor.epoch, seq: input.cursor.endSeq });
  }

  return planTimelineTailFetch();
}

export function planTimelineCatchUpAfter(cursor: TimelineSyncCursor) {
  return {
    direction: "after",
    cursor,
    limit: TIMELINE_FETCH_PAGE_SIZE,
    projection: "projected",
  } as const;
}

export function planTimelineTailFetch() {
  return {
    direction: "tail",
    limit: TIMELINE_FETCH_PAGE_SIZE,
    projection: "projected",
  } as const;
}

export function planTimelineResumeFetch(
  range: { epoch: string; endSeq: number } | null | undefined,
): ProjectedTimelineForwardFetchPlan {
  return range
    ? planTimelineCatchUpAfter({ epoch: range.epoch, seq: range.endSeq })
    : planTimelineTailFetch();
}

export function planTimelineOlderFetch(cursor: TimelineSyncCursor) {
  return {
    direction: "before",
    cursor,
    limit: TIMELINE_FETCH_PAGE_SIZE,
    projection: "projected",
  } as const;
}

export function planTimelinePromptJump(target: TimelineSyncCursor) {
  const newerRows = Math.floor(TIMELINE_FETCH_PAGE_SIZE / 2);
  return {
    direction: "before",
    cursor: { epoch: target.epoch, seq: target.seq + newerRows + 1 },
    limit: TIMELINE_FETCH_PAGE_SIZE,
    projection: "projected",
    mergeWindow: true,
  } as const;
}

export function planTimelineCatchUpFollowUp(input: {
  direction: "tail" | "before" | "after";
  hasNewer: boolean;
  endCursor: TimelineSyncCursor | null;
  error: string | null;
}): ProjectedTimelineAfterFetchPlan | null {
  if (input.error || input.direction !== "after" || !input.hasNewer || !input.endCursor) {
    return null;
  }

  return planTimelineCatchUpAfter(input.endCursor);
}

export function isTimelineCatchUpComplete(input: {
  direction: "tail" | "before" | "after";
  hasNewer: boolean;
  error: string | null;
}): boolean {
  if (input.error) {
    return false;
  }

  return input.direction !== "after" || !input.hasNewer;
}

export function isTimelineResumeSnapshotAuthoritative(input: {
  direction: "tail" | "before" | "after";
  hasNewer: boolean;
  error: string | null;
}): boolean {
  if (input.error || input.direction === "before") return false;
  return input.direction === "tail" || !input.hasNewer;
}
