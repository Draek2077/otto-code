// The outline rail occupies the first 44px of the chat pane. A full-width
// chat needs 24px of extra inner clearance so its content does not sit under
// the rail. Capped lanes approach that clearance smoothly as they occupy more
// of the pane, instead of jumping when a particular viewport width is crossed.
export const CHAT_OUTLINE_CLEARANCE = 24;
const OUTLINE_CLEARANCE_CURVE = 8;

export function resolveChatOutlinePadding(input: {
  railVisible: boolean;
  paneWidth: number;
  chatMaxWidth: number | undefined;
}): number {
  if (!input.railVisible || input.paneWidth <= 0) {
    return 0;
  }
  const laneWidth = Math.min(input.chatMaxWidth ?? input.paneWidth, input.paneWidth);
  const laneShare = laneWidth / input.paneWidth;
  return CHAT_OUTLINE_CLEARANCE * laneShare ** OUTLINE_CLEARANCE_CURVE;
}
