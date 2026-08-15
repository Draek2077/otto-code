import type { CommunicationMessage } from "@otto-code/protocol/communications";

export interface ReplyThreadState {
  expanded: ReadonlySet<string>;
  /**
   * The single branch currently hosting the inline reply composer. Clicking
   * Reply on a new message moves the composer here rather than cloning it:
   * opening one branch never opens a second, and a branch may stay expanded
   * (readable) even when it is no longer the active reply target.
   */
  activeReplyId: string | null;
  focusVersions: Readonly<Record<string, number>>;
  messagesByParent: Readonly<Record<string, readonly CommunicationMessage[]>>;
  failedLoads: ReadonlySet<string>;
}

export const emptyReplyThreadState: ReplyThreadState = {
  expanded: new Set(),
  activeReplyId: null,
  focusVersions: {},
  messagesByParent: {},
  failedLoads: new Set(),
};

/**
 * Reply is an intent to compose, never a toggle. Each invocation moves the
 * single reply composer to this branch and reclaims its focus. Any previously
 * active branch keeps its loaded replies and draft; only the composer relocates.
 */
export function openReplyThread(
  state: ReplyThreadState,
  parentMessageId: string,
): ReplyThreadState {
  const failedLoads = new Set(state.failedLoads);
  failedLoads.delete(parentMessageId);
  return {
    ...state,
    expanded: new Set([...state.expanded, parentMessageId]),
    activeReplyId: parentMessageId,
    focusVersions: {
      ...state.focusVersions,
      [parentMessageId]: (state.focusVersions[parentMessageId] ?? 0) + 1,
    },
    failedLoads,
  };
}

/**
 * Expand is a read action. It reveals a branch's replies but does not claim
 * the reply composer: the single active reply target is unchanged.
 */
export function expandReplyThread(
  state: ReplyThreadState,
  parentMessageId: string,
): ReplyThreadState {
  const failedLoads = new Set(state.failedLoads);
  failedLoads.delete(parentMessageId);
  return {
    ...state,
    expanded: new Set([...state.expanded, parentMessageId]),
    failedLoads,
  };
}

export function collapseReplyThread(
  state: ReplyThreadState,
  parentMessageId: string,
): ReplyThreadState {
  const expanded = new Set(state.expanded);
  expanded.delete(parentMessageId);
  return {
    ...state,
    expanded,
    activeReplyId: state.activeReplyId === parentMessageId ? null : state.activeReplyId,
  };
}

/**
 * Thread API responses are not ordered evidence. Only a provider-confirmed
 * parent id may place a message into a visible reply branch.
 */
export function storeReplyThread(
  state: ReplyThreadState,
  parentMessageId: string,
  messages: readonly CommunicationMessage[],
): ReplyThreadState {
  const failedLoads = new Set(state.failedLoads);
  failedLoads.delete(parentMessageId);
  return {
    ...state,
    messagesByParent: {
      ...state.messagesByParent,
      [parentMessageId]: messages
        .filter((message) => message.parentMessageId === parentMessageId)
        .slice()
        .sort(compareMessages),
    },
    failedLoads,
  };
}

/** A failed history fetch may report an error, but never closes the compose branch. */
export function recordReplyThreadLoadFailure(
  state: ReplyThreadState,
  parentMessageId: string,
): ReplyThreadState {
  return { ...state, failedLoads: new Set([...state.failedLoads, parentMessageId]) };
}

export function appendConfirmedReply(
  state: ReplyThreadState,
  parentMessageId: string,
  message: CommunicationMessage,
): ReplyThreadState {
  if (message.parentMessageId !== parentMessageId) return state;
  return storeReplyThread(state, parentMessageId, [
    ...(state.messagesByParent[parentMessageId] ?? []),
    message,
  ]);
}

export function replyComposerAutoFocusKey(
  state: ReplyThreadState,
  parentMessageId: string,
): string {
  return `communications:${parentMessageId}:reply:${state.focusVersions[parentMessageId] ?? 0}`;
}

function compareMessages(left: CommunicationMessage, right: CommunicationMessage): number {
  return (
    (left.sentAt ?? "").localeCompare(right.sentAt ?? "") ||
    left.messageId.localeCompare(right.messageId)
  );
}
