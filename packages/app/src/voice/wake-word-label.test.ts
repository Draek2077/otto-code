import { describe, expect, it } from "vitest";

import { getWakeWordLabel } from "./wake-word-label";
import { getWakeWordIconKind } from "./wake-word-icon";
import { getWakeWordSettingsRoute } from "./wake-word-navigation";

describe("getWakeWordLabel", () => {
  it("uses the concise workspace icon labels", () => {
    expect(getWakeWordLabel("error")).toBe("Hey Otto - error");
    expect(getWakeWordLabel("listening")).toBe("Hey Otto - detecting");
    expect(getWakeWordLabel("disabled")).toBe("Hey Otto - disabled");
    expect(getWakeWordLabel("recording")).toBe("Hey Otto - recording");
    expect(getWakeWordLabel("processing")).toBe("Hey Otto - processing");
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
