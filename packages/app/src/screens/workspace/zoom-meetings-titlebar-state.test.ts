import { describe, expect, test } from "vitest";
import { getZoomMeetingTitlebarState } from "./zoom-meetings-titlebar-state";

describe("getZoomMeetingTitlebarState", () => {
  test("keeps the user-facing meeting states visually distinct", () => {
    expect(getZoomMeetingTitlebarState("idle")).toEqual({
      label: "Detecting",
      tone: "success",
    });
    expect(getZoomMeetingTitlebarState("recording")).toEqual({
      label: "Recording",
      tone: "danger",
    });
    expect(getZoomMeetingTitlebarState("ready")).toEqual({
      label: "Ready",
      tone: "info",
    });
    expect(getZoomMeetingTitlebarState("setup", true)).toEqual({
      label: "Detecting",
      tone: "success",
    });
  });
});
