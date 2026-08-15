import type { CommunicationMessage } from "@otto-code/protocol/communications";

export interface CommunicationsMessageLayout {
  message: CommunicationMessage;
  isFirstInSenderGroup: boolean;
  isLastInSenderGroup: boolean;
}

export function compareCommunicationsMessages(
  left: CommunicationMessage,
  right: CommunicationMessage,
): number {
  return (
    (left.sentAt ?? "").localeCompare(right.sentAt ?? "") ||
    left.messageId.localeCompare(right.messageId)
  );
}

function sharesSenderGroup(
  left: CommunicationMessage | undefined,
  right: CommunicationMessage,
): boolean {
  return (
    left?.senderId === right.senderId &&
    left?.senderDisplayName === right.senderDisplayName &&
    left?.isFromCurrentUser === right.isFromCurrentUser
  );
}

/**
 * The top-level timeline is chronological; reply topology is not inferred
 * here. A message belongs below a root only when its explicit parent link says
 * so, and thread retrieval renders that branch separately.
 */
export function layoutCommunicationsTimeline(
  messages: readonly CommunicationMessage[],
): CommunicationsMessageLayout[] {
  const topLevelMessages = messages
    .filter((message) => message.parentMessageId === null || message.parentMessageId === undefined)
    .toSorted(compareCommunicationsMessages);
  return topLevelMessages.map((message, index) => ({
    message,
    isFirstInSenderGroup: !sharesSenderGroup(topLevelMessages[index - 1], message),
    isLastInSenderGroup: !sharesSenderGroup(topLevelMessages[index + 1], message),
  }));
}
