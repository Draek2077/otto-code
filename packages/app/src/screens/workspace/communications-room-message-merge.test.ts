import { describe, expect, it } from "vitest";
import type { CommunicationMessage, CommunicationRoom } from "@otto-code/protocol/communications";
import { mergeRoomMessages } from "./communications-room-message-merge";

function message(
  input: Partial<CommunicationMessage> & Pick<CommunicationMessage, "messageId">,
): CommunicationMessage {
  return {
    providerId: "zoom-team-chat",
    conversationId: "room-1",
    senderId: "person-1",
    text: input.messageId,
    sentAt: "2026-08-15T12:00:00.000Z",
    ...input,
  };
}

function room(messages: CommunicationMessage[]): CommunicationRoom {
  return {
    conversation: {
      providerId: "zoom-team-chat",
      conversationId: "room-1",
      kind: "direct",
      title: "Ada",
      preview: null,
      updatedAt: null,
      unreadCount: 0,
    },
    messages,
    capabilities: {
      canCompose: true,
      canReply: true,
      canRetrieveThreads: true,
      canReact: true,
      canMarkRead: false,
      unavailableReason: null,
    },
  };
}

describe("mergeRoomMessages", () => {
  it("adopts the polled fetch as authoritative", () => {
    const current = room([message({ messageId: "root" })]);
    const next = room([message({ messageId: "root" }), message({ messageId: "incoming" })]);

    expect(mergeRoomMessages(current, next).messages.map((item) => item.messageId)).toEqual([
      "root",
      "incoming",
    ]);
  });

  it("keeps a just-sent message the poll has not caught up to yet", () => {
    const current = room([message({ messageId: "root" }), message({ messageId: "just-sent" })]);
    const next = room([message({ messageId: "root" })]);

    expect(mergeRoomMessages(current, next).messages.map((item) => item.messageId)).toEqual([
      "root",
      "just-sent",
    ]);
  });

  it("takes updated fields (reactions, capabilities, conversation) from the poll", () => {
    const current = room([message({ messageId: "root", reactions: [] })]);
    const next = {
      ...room([message({ messageId: "root", reactions: [{ emoji: "👍", count: 1 }] })]),
      capabilities: { ...room([]).capabilities, canCompose: false },
    };

    const merged = mergeRoomMessages(current, next);
    expect(merged.messages[0]?.reactions).toEqual([{ emoji: "👍", count: 1 }]);
    expect(merged.capabilities.canCompose).toBe(false);
  });
});
