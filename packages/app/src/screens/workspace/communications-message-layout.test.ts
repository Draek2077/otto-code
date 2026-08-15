import { describe, expect, it } from "vitest";
import type { CommunicationMessage } from "@otto-code/protocol/communications";
import { layoutCommunicationsTimeline } from "./communications-message-layout";

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

describe("layoutCommunicationsTimeline", () => {
  it("groups chronological roots while keeping explicit replies out of the timeline", () => {
    const layout = layoutCommunicationsTimeline([
      message({ messageId: "third", sentAt: "2026-08-15T12:03:00.000Z", senderId: "person-2" }),
      message({ messageId: "reply", sentAt: "2026-08-15T12:01:00.000Z", parentMessageId: "root" }),
      message({ messageId: "second", sentAt: "2026-08-15T12:02:00.000Z" }),
      message({ messageId: "root", sentAt: "2026-08-15T12:00:00.000Z" }),
    ]);

    expect(layout.map(({ message: item }) => item.messageId)).toEqual(["root", "second", "third"]);
    expect(layout.map(({ isFirstInSenderGroup }) => isFirstInSenderGroup)).toEqual([
      true,
      false,
      true,
    ]);
    expect(layout.map(({ isLastInSenderGroup }) => isLastInSenderGroup)).toEqual([
      false,
      true,
      true,
    ]);
  });
});
