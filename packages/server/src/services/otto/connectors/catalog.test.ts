import { describe, expect, it, vi } from "vitest";
import { prepareConnectorTools } from "./catalog.js";
import type { PaseoToolRuntimeContext } from "../../../server/agent/tools/types.js";

describe("Connector provider preparation", () => {
  it("prepares tools for a native session from its trusted launch directory before registry publication", async () => {
    const definitions = vi.fn(async (_cwd: string) => []);
    await prepareConnectorTools({
      host: { definitions },
      enabled: true,
      cwd: "actual-launch-directory",
      runtime: {
        callerAgentId: "not-yet-registered",
        callerCwd: "actual-launch-directory",
        callerPurpose: "interactive",
      },
    });
    expect(definitions).toHaveBeenCalledExactlyOnceWith("actual-launch-directory");
  });
  it.each([
    { enabled: false, runtime: { callerAgentId: "chat" } },
    { enabled: true, runtime: {} },
    { enabled: true, runtime: { callerAgentId: "chat", voiceOnly: true } },
    { enabled: true, runtime: { callerAgentId: "chat", callerPurpose: "history" } },
    { enabled: true, runtime: { callerAgentId: "chat", paseoToolPolicy: { enabled: false } } },
  ] satisfies Array<{ enabled: boolean; runtime: PaseoToolRuntimeContext }>)(
    "does not acquire account connections outside an admitted interactive scope (%#)",
    async ({ enabled, runtime }) => {
      const definitions = vi.fn(async (_cwd: string) => []);
      expect(
        await prepareConnectorTools({ host: { definitions }, cwd: "workspace", enabled, runtime }),
      ).toEqual([]);
      expect(definitions).not.toHaveBeenCalled();
    },
  );
});
