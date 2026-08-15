import { describe, expect, it } from "vitest";
import {
  canPlayRoomMessage,
  shouldRevealRoomMessageControls,
} from "./communications-room-message-utils";

describe("communications room message controls", () => {
  it("only offers in-bubble playback for incoming messages", () => {
    expect(canPlayRoomMessage({ isFromCurrentUser: false, senderId: "colleague" })).toBe(true);
    expect(canPlayRoomMessage({ isFromCurrentUser: true, senderId: "me" })).toBe(false);
    expect(canPlayRoomMessage({ isFromCurrentUser: false, senderId: null })).toBe(false);
    expect(canPlayRoomMessage({ senderId: "unknown-author" })).toBe(false);
  });

  it("keeps hidden desktop controls available on hover and keyboard focus", () => {
    const hiddenDesktop = {
      hideMessageDetails: true,
      isCompact: false,
      isHovered: false,
      isNative: false,
    };

    expect(shouldRevealRoomMessageControls({ ...hiddenDesktop, hasFooterFocus: false })).toBe(
      false,
    );
    expect(shouldRevealRoomMessageControls({ ...hiddenDesktop, hasFooterFocus: true })).toBe(true);
    expect(
      shouldRevealRoomMessageControls({ ...hiddenDesktop, isHovered: true, hasFooterFocus: false }),
    ).toBe(true);
    expect(
      shouldRevealRoomMessageControls({ ...hiddenDesktop, isCompact: true, hasFooterFocus: false }),
    ).toBe(true);
  });
});
