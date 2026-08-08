import { describe, expect, it } from "vitest";

import { getWakeWordCapability } from "./wake-word-capability";
import { createWakeWordDetector } from "./wake-word-detector";

describe("wake-word capability", () => {
  it("fails closed when the native model capability is unavailable", async () => {
    const capability = getWakeWordCapability();
    expect(capability.available).toBe(false);
    expect(capability.safePhraseSupported).toBe(false);

    await expect(
      createWakeWordDetector().start({ phrase: "Hey Otto", sensitivity: 0.7 }),
    ).rejects.toThrow();
  });
});
