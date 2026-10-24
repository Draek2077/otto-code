import { expect, test, vi } from "vitest";

// Reproduce the CI boundary: unrelated runtime imports cannot evaluate native
// animation/UI modules, even when the Brain installation is constructed.
vi.mock("./plugin-ui", () => {
  throw new Error("Native presentation evaluated before render");
});
import { createBrainPluginUi } from "./client-bridge";

test.each([false, true])(
  "Brain registration stays passive with an already-closed installation=%s",
  async (closed) => {
    const lifetime = new AbortController();
    if (closed) lifetime.abort();
    let calls = 0;
    const ui = createBrainPluginUi(
      {
        serverId: "fixture",
        lifetime,
        invoke: async () => {
          calls++;
          throw new Error("Unexpected host request during registration");
        },
      },
      { openBrain() {}, openSettings() {} },
    );
    expect(Object.keys(ui).sort()).toEqual(["BrainScreen", "BrainSettings", "BrainSidebar"]);
    lifetime.abort();
    await Promise.resolve();
    expect(calls).toBe(0);
  },
);
