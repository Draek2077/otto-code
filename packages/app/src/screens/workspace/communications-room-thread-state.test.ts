import { describe, expect, it } from "vitest";
import type { CommunicationMessage } from "@otto-code/protocol/communications";
import {
  appendConfirmedReply,
  collapseReplyThread,
  emptyReplyThreadState,
  expandReplyThread,
  openReplyThread,
  recordReplyThreadLoadFailure,
  replyComposerAutoFocusKey,
  storeReplyThread,
} from "./communications-room-thread-state";

const rootId = "root-1";
const otherRootId = "root-2";

function message(overrides: Partial<CommunicationMessage> = {}): CommunicationMessage {
  return {
    providerId: "zoom-team-chat",
    conversationId: "channel-1",
    messageId: "reply-1",
    senderId: "person-1",
    text: "Reply",
    sentAt: "2026-08-15T12:00:00.000Z",
    ...overrides,
  };
}

describe("communications room reply threads", () => {
  it("opens a reply branch and reclaims its composer focus on every Reply action", () => {
    const opened = openReplyThread(emptyReplyThreadState, rootId);
    const refocused = openReplyThread(opened, rootId);

    expect(opened.expanded.has(rootId)).toBe(true);
    expect(replyComposerAutoFocusKey(opened, rootId)).toBe("communications:root-1:reply:1");
    expect(replyComposerAutoFocusKey(refocused, rootId)).toBe("communications:root-1:reply:2");
  });

  it("collapses a branch without discarding its reply history or focus lifecycle", () => {
    const opened = storeReplyThread(openReplyThread(emptyReplyThreadState, rootId), rootId, [
      message({ parentMessageId: rootId }),
    ]);
    const collapsed = collapseReplyThread(opened, rootId);

    expect(collapsed.expanded.has(rootId)).toBe(false);
    expect(collapsed.messagesByParent[rootId]).toEqual([message({ parentMessageId: rootId })]);
    expect(replyComposerAutoFocusKey(collapsed, rootId)).toBe("communications:root-1:reply:1");
  });

  it("expands an existing branch without replacing its reply-composer focus request", () => {
    const expanded = expandReplyThread(emptyReplyThreadState, rootId);

    expect(expanded.expanded.has(rootId)).toBe(true);
    expect(replyComposerAutoFocusKey(expanded, rootId)).toBe("communications:root-1:reply:0");
  });

  it("keeps an opened reply composer when historic thread loading fails", () => {
    const opened = openReplyThread(emptyReplyThreadState, rootId);
    const afterFailedLoad = recordReplyThreadLoadFailure(opened, rootId);

    expect(afterFailedLoad.expanded.has(rootId)).toBe(true);
    expect(afterFailedLoad.failedLoads.has(rootId)).toBe(true);
    expect(replyComposerAutoFocusKey(afterFailedLoad, rootId)).toBe(
      "communications:root-1:reply:1",
    );
  });

  it("moves the single active reply composer instead of cloning it", () => {
    const openedA = openReplyThread(emptyReplyThreadState, rootId);
    const openedB = openReplyThread(openedA, otherRootId);

    expect(openedA.activeReplyId).toBe(rootId);
    expect(openedB.activeReplyId).toBe(otherRootId);
    // The previous branch stays expanded and readable; only the composer relocates.
    expect(openedB.expanded.has(rootId)).toBe(true);
    expect(openedB.expanded.has(otherRootId)).toBe(true);
  });

  it("reading a branch never claims the reply composer from the active target", () => {
    const opened = openReplyThread(emptyReplyThreadState, rootId);
    const readOther = expandReplyThread(opened, otherRootId);

    expect(readOther.activeReplyId).toBe(rootId);
  });

  it("clears the active reply target when its branch is collapsed", () => {
    const opened = openReplyThread(emptyReplyThreadState, rootId);
    const collapsed = collapseReplyThread(opened, rootId);

    expect(collapsed.activeReplyId).toBeNull();
  });

  it("renders only replies with the explicit parent relationship", () => {
    const state = storeReplyThread(emptyReplyThreadState, rootId, [
      message({ messageId: "wrong-parent", parentMessageId: otherRootId }),
      message({ messageId: "root-reply", parentMessageId: rootId }),
    ]);

    expect(state.messagesByParent[rootId]).toEqual([
      message({ messageId: "root-reply", parentMessageId: rootId }),
    ]);
    expect(appendConfirmedReply(state, rootId, message({ parentMessageId: otherRootId }))).toBe(
      state,
    );
  });
});
