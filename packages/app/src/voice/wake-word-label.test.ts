import { describe, expect, it } from "vitest";

import { getWakeWordLabel } from "./wake-word-label";
import { getWakeWordIconKind } from "./wake-word-icon";
import { getWakeWordSettingsRoute } from "./wake-word-navigation";

describe("getWakeWordLabel", () => {
  it("uses the title-bar status-label format", () => {
    expect(
      getWakeWordLabel({
        detectorState: "disabled",
        displayedState: "listening",
        listeningPaused: false,
      }),
    ).toBe("Hey Otto: Enabled");
    expect(
      getWakeWordLabel({
        detectorState: "listening",
        displayedState: "listening",
        listeningPaused: false,
      }),
    ).toBe("Hey Otto: Detecting");
    expect(
      getWakeWordLabel({
        detectorState: "listening",
        displayedState: "disabled",
        listeningPaused: true,
      }),
    ).toBe("Hey Otto: Disabled");
    expect(
      getWakeWordLabel({
        detectorState: "recording",
        displayedState: "recording",
        listeningPaused: false,
      }),
    ).toBe("Hey Otto: Recording");
    expect(
      getWakeWordLabel({
        detectorState: "processing",
        displayedState: "processing",
        listeningPaused: false,
      }),
    ).toBe("Hey Otto: Processing");
  });
});

describe("getWakeWordIconKind", () => {
  it("uses the off voice-selection icon for errors so they cannot look like recording", () => {
    expect(getWakeWordIconKind("error")).toBe("muted");
    expect(getWakeWordIconKind("recording")).toBe("recording");
  });
});

describe("getWakeWordSettingsRoute", () => {
  it("opens the host Agents settings instead of disabling Hey Otto", () => {
    expect(getWakeWordSettingsRoute("host with spaces")).toBe(
      "/settings/hosts/host%20with%20spaces/agents",
    );
  });
});
