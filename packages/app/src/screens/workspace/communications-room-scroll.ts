/**
 * Communications rooms use the same reader-ownership contract as the agent
 * stream, without its history virtualization. A room only writes the viewport
 * while it is following the newest content.
 */
export type CommunicationsRoomScrollMode = "following" | "detached";

/** Session-lifetime retention lets a hidden room preserve reader ownership. */
const retainedModes = new Map<string, CommunicationsRoomScrollMode>();

export type CommunicationsRoomScrollChange =
  | "opened"
  | "new-message"
  | "viewport-resize"
  | "historic-thread-expansion";

/** A small band avoids fractional-offset churn at display-scale boundaries. */
export const COMMUNICATIONS_ROOM_BOTTOM_BAND_PX = 32;

export function readCommunicationsRoomScrollMode(key: string): CommunicationsRoomScrollMode {
  return retainedModes.get(key) ?? "following";
}

export function retainCommunicationsRoomScrollMode(
  key: string,
  mode: CommunicationsRoomScrollMode,
): void {
  retainedModes.set(key, mode);
}

export function isCommunicationsRoomNearBottom(input: {
  contentHeight: number;
  offsetY: number;
  viewportHeight: number;
}): boolean {
  const distanceFromBottom = input.contentHeight - (input.offsetY + input.viewportHeight);
  return distanceFromBottom <= COMMUNICATIONS_ROOM_BOTTOM_BAND_PX;
}

/** Scroll events, not wheel or touch handlers, decide whether the reader owns the position. */
export function deriveCommunicationsRoomScrollMode(input: {
  current: CommunicationsRoomScrollMode;
  isNearBottom: boolean;
}): CommunicationsRoomScrollMode {
  if (input.isNearBottom) return "following";
  return input.current === "following" ? "detached" : input.current;
}

/** Historic thread expansion is a local inspection action, never a request to jump to the tail. */
export function shouldAnchorCommunicationsRoomChange(input: {
  mode: CommunicationsRoomScrollMode;
  change: CommunicationsRoomScrollChange;
}): boolean {
  if (input.mode !== "following") return false;
  return input.change !== "historic-thread-expansion";
}
