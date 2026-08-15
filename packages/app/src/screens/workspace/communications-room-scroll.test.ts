import { describe, expect, it } from "vitest";
import {
  COMMUNICATIONS_ROOM_BOTTOM_BAND_PX,
  deriveCommunicationsRoomScrollMode,
  isCommunicationsRoomNearBottom,
  shouldAnchorCommunicationsRoomChange,
} from "./communications-room-scroll";

describe("communications room scroll ownership", () => {
  it("uses one fractional-safe bottom band to detach and reattach", () => {
    expect(
      isCommunicationsRoomNearBottom({
        contentHeight: 1200,
        offsetY: 719.5,
        viewportHeight: 448.75,
      }),
    ).toBe(true);
    expect(
      isCommunicationsRoomNearBottom({
        contentHeight: 1200,
        offsetY: 719,
        viewportHeight: 448,
      }),
    ).toBe(false);
    expect(COMMUNICATIONS_ROOM_BOTTOM_BAND_PX).toBe(32);

    expect(deriveCommunicationsRoomScrollMode({ current: "following", isNearBottom: false })).toBe(
      "detached",
    );
    expect(deriveCommunicationsRoomScrollMode({ current: "detached", isNearBottom: true })).toBe(
      "following",
    );
  });

  it("never anchors a detached reader for new messages, thread children, or resize", () => {
    for (const change of ["new-message", "historic-thread-expansion", "viewport-resize"] as const) {
      expect(shouldAnchorCommunicationsRoomChange({ mode: "detached", change })).toBe(false);
    }
  });

  it("lets an attached reader follow genuine new content but not fetched history", () => {
    expect(shouldAnchorCommunicationsRoomChange({ mode: "following", change: "opened" })).toBe(
      true,
    );
    expect(shouldAnchorCommunicationsRoomChange({ mode: "following", change: "new-message" })).toBe(
      true,
    );
    expect(
      shouldAnchorCommunicationsRoomChange({ mode: "following", change: "viewport-resize" }),
    ).toBe(true);
    expect(
      shouldAnchorCommunicationsRoomChange({
        mode: "following",
        change: "historic-thread-expansion",
      }),
    ).toBe(false);
  });
});
