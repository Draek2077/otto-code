import { create } from "zustand";
import type { FileSearchSummary } from "@otto-code/client/internal/daemon-client";
import type { FileSearchMatch } from "@otto-code/protocol/messages";

/**
 * A workspace's live Search session: the query, its options, and the results it
 * produced.
 *
 * It lives outside the pane because the pane unmounts the moment the reader
 * leaves the Search tab - and a reader who found 2000 hits leaves constantly:
 * open a hit, read the file, check Changes, come back. Losing the results on
 * every one of those trips makes the pane unusable for the investigation it
 * exists for. Deliberately memory-only: results are a snapshot of a working
 * tree that keeps moving, so they are worth carrying across a tab switch but
 * never across an app restart.
 */

export interface SearchFileResult {
  path: string;
  hash: string;
  matches: FileSearchMatch[];
}

export type SearchPhase = "idle" | "searching" | "done" | "error";

export interface ProjectSearchSession {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
  phase: SearchPhase;
  results: SearchFileResult[];
  summary: FileSearchSummary | null;
  collapsedFiles: ReadonlySet<string>;
  /** Replace mode defaults every match to selected; this records the exceptions. */
  uncheckedMatches: ReadonlySet<string>;
  replaceOpen: boolean;
  replacement: string;
  replacing: boolean;
  /** Bumped per run, so a superseded search's late stream events are ignored. */
  runToken: number;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

export const EMPTY_PROJECT_SEARCH_SESSION: ProjectSearchSession = {
  query: "",
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
  phase: "idle",
  results: [],
  summary: null,
  collapsedFiles: EMPTY_SET,
  uncheckedMatches: EMPTY_SET,
  replaceOpen: false,
  replacement: "",
  replacing: false,
  runToken: 0,
};

/**
 * How many workspaces keep a session. A result set is the largest thing this
 * pane holds, so the map is bounded rather than left to grow with every
 * workspace visited in a session; three covers moving between a worktree, its
 * base checkout, and one other project without re-running a search.
 */
const MAX_RETAINED_SESSIONS = 3;

export function buildProjectSearchScopeKey(input: {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
}): string {
  return `${input.serverId}:${input.workspaceId ?? input.workspaceRoot}`;
}

/**
 * Where the results list was scrolled to, kept out of the store on purpose: it
 * changes on every scroll frame, and a store write there would re-render the
 * whole result list while the reader is scrolling it.
 */
const scrollOffsets = new Map<string, number>();

export function rememberProjectSearchScrollOffset(scopeKey: string, offset: number): void {
  scrollOffsets.set(scopeKey, offset);
}

export function readProjectSearchScrollOffset(scopeKey: string): number {
  return scrollOffsets.get(scopeKey) ?? 0;
}

type SessionUpdate =
  | Partial<ProjectSearchSession>
  | ((session: ProjectSearchSession) => Partial<ProjectSearchSession>);

/**
 * How long streamed file results are pooled before they land in the store.
 * A wide search streams a result per matched file in a burst; writing each one
 * straight through would re-render the whole list per event. Matches the chat
 * reducer's flush cadence, which exists for the same reason (see the
 * client-state topology record: nothing writes stream state per event).
 */
const RESULT_FLUSH_MS = 48;

interface PendingResults {
  runToken: number;
  files: SearchFileResult[];
  timer: ReturnType<typeof setTimeout> | null;
}

const pending = new Map<string, PendingResults>();

function discardPending(scopeKey: string): void {
  const buffered = pending.get(scopeKey);
  if (buffered?.timer) {
    clearTimeout(buffered.timer);
  }
  pending.delete(scopeKey);
}

interface ProjectSearchSessionState {
  sessions: Record<string, ProjectSearchSession>;
  /** Least-recently-touched first, for eviction. */
  order: string[];
  updateSession: (scopeKey: string, update: SessionUpdate) => void;
  /** Starts a run: clears the previous results and returns the new run token. */
  beginRun: (scopeKey: string) => number;
  /**
   * Buffers a streamed file result, ignoring events from a superseded run. The
   * buffer lands in the store on the next flush, not on this call.
   */
  appendResult: (scopeKey: string, runToken: number, file: SearchFileResult) => void;
  /** Drains buffered results immediately. */
  flushResults: (scopeKey: string) => void;
  /** Settles a finished run: drains the buffer, then records its outcome. */
  finishRun: (
    scopeKey: string,
    runToken: number,
    outcome: { summary: FileSearchSummary } | { failed: true },
  ) => void;
  /** True while `runToken` is still the session's current run. */
  isCurrentRun: (scopeKey: string, runToken: number) => boolean;
  /** Clears the query and its results, keeping the pane's modes as they are. */
  clearSession: (scopeKey: string) => void;
}

function touch(
  state: ProjectSearchSessionState,
  scopeKey: string,
  session: ProjectSearchSession,
): Pick<ProjectSearchSessionState, "sessions" | "order"> {
  const order = [...state.order.filter((key) => key !== scopeKey), scopeKey];
  const sessions = { ...state.sessions, [scopeKey]: session };
  while (order.length > MAX_RETAINED_SESSIONS) {
    const evicted = order.shift();
    if (evicted !== undefined) {
      delete sessions[evicted];
      scrollOffsets.delete(evicted);
      discardPending(evicted);
    }
  }
  return { sessions, order };
}

export const useProjectSearchSessionStore = create<ProjectSearchSessionState>()((set, get) => ({
  sessions: {},
  order: [],

  updateSession: (scopeKey, update) =>
    set((state) => {
      const current = state.sessions[scopeKey] ?? EMPTY_PROJECT_SEARCH_SESSION;
      const patch = typeof update === "function" ? update(current) : update;
      return touch(state, scopeKey, { ...current, ...patch });
    }),

  beginRun: (scopeKey) => {
    const nextToken = (get().sessions[scopeKey]?.runToken ?? 0) + 1;
    discardPending(scopeKey);
    set((state) => {
      const current = state.sessions[scopeKey] ?? EMPTY_PROJECT_SEARCH_SESSION;
      return touch(state, scopeKey, {
        ...current,
        phase: "searching",
        results: [],
        summary: null,
        collapsedFiles: EMPTY_SET,
        uncheckedMatches: EMPTY_SET,
        runToken: nextToken,
      });
    });
    scrollOffsets.delete(scopeKey);
    return nextToken;
  },

  appendResult: (scopeKey, runToken, file) => {
    if (!get().isCurrentRun(scopeKey, runToken)) {
      return;
    }
    const buffered = pending.get(scopeKey);
    if (buffered && buffered.runToken === runToken) {
      buffered.files.push(file);
      return;
    }
    discardPending(scopeKey);
    pending.set(scopeKey, {
      runToken,
      files: [file],
      timer: setTimeout(() => get().flushResults(scopeKey), RESULT_FLUSH_MS),
    });
  },

  flushResults: (scopeKey) => {
    const buffered = pending.get(scopeKey);
    if (!buffered) {
      return;
    }
    discardPending(scopeKey);
    set((state) => {
      const current = state.sessions[scopeKey];
      if (!current || current.runToken !== buffered.runToken) {
        return state;
      }
      return touch(state, scopeKey, {
        ...current,
        results: [...current.results, ...buffered.files],
      });
    });
  },

  finishRun: (scopeKey, runToken, outcome) => {
    if (!get().isCurrentRun(scopeKey, runToken)) {
      return;
    }
    get().flushResults(scopeKey);
    set((state) => {
      const current = state.sessions[scopeKey];
      if (!current || current.runToken !== runToken) {
        return state;
      }
      return touch(
        state,
        scopeKey,
        "failed" in outcome
          ? { ...current, phase: "error" }
          : { ...current, phase: "done", summary: outcome.summary },
      );
    });
  },

  isCurrentRun: (scopeKey, runToken) => get().sessions[scopeKey]?.runToken === runToken,

  clearSession: (scopeKey) =>
    set((state) => {
      const current = state.sessions[scopeKey];
      if (!current) {
        return state;
      }
      discardPending(scopeKey);
      scrollOffsets.delete(scopeKey);
      return touch(state, scopeKey, {
        ...current,
        query: "",
        phase: "idle",
        results: [],
        summary: null,
        collapsedFiles: EMPTY_SET,
        uncheckedMatches: EMPTY_SET,
        replacement: "",
        // A cleared session must not accept the in-flight run's late results.
        runToken: current.runToken + 1,
      });
    }),
}));
