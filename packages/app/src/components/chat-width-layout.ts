// The outline rail occupies the first 44px of the chat pane. Reserve a stable
// inner gutter whenever the rail is present: a measured gutter starts at zero,
// then visibly moves the chat once onLayout reports the pane width.
export const CHAT_OUTLINE_CLEARANCE = 24;

export function resolveChatOutlinePadding({ railVisible }: { railVisible: boolean }): number {
  return railVisible ? CHAT_OUTLINE_CLEARANCE : 0;
}
