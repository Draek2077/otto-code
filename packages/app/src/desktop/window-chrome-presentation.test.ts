import { describe, expect, it } from "vitest";
import { DESKTOP_WINDOW_CONTROLS_HEIGHT, HEADER_INNER_HEIGHT } from "@/constants/layout";
import { getDesktopWindowControlsPresentation } from "./window-chrome-presentation";

describe("getDesktopWindowControlsPresentation", () => {
  it.each(["custom-windows", "custom-linux"] as const)(
    "%s reserves the shared separator below the main workspace chrome",
    (mode) => {
      const presentation = getDesktopWindowControlsPresentation(mode);

      expect(DESKTOP_WINDOW_CONTROLS_HEIGHT).toBe(HEADER_INNER_HEIGHT);
      expect(presentation.railHeight).toBe(HEADER_INNER_HEIGHT);
      expect(presentation.controlHeight).toBe(HEADER_INNER_HEIGHT - 1);
    },
  );
});
