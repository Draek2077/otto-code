import type { CommunicationMessage } from "@otto-code/protocol/communications";

/** Incoming provider messages alone are eligible for in-bubble playback. */
export function canPlayRoomMessage(
  message: Pick<CommunicationMessage, "isFromCurrentUser" | "senderId">,
): boolean {
  return message.isFromCurrentUser === false && message.senderId !== null;
}

/** Hover is a desktop convenience; focus, compact, and native remain actionable paths. */
export function shouldRevealRoomMessageControls({
  hasFooterFocus,
  hideMessageDetails,
  isCompact,
  isHovered,
  isNative,
}: {
  hasFooterFocus: boolean;
  hideMessageDetails: boolean;
  isCompact: boolean;
  isHovered: boolean;
  isNative: boolean;
}): boolean {
  return !hideMessageDetails || isNative || isCompact || isHovered || hasFooterFocus;
}
