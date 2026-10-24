import { describe, expect, it, vi } from "vitest";
import { restartRemoteBrain } from "./remote-restart.js";
import type { BrainControllerTransport } from "./controller.js";

function fixture() {
  const request = vi.fn<BrainControllerTransport["request"]>().mockImplementation(async (route) => {
    if (route === "/__host/capabilities") return { restart: true, writable: true };
    if (route === "/__host/status") return { instanceId: "selected-owner-lifetime" };
    return { accepted: true, instanceId: "selected-owner-lifetime" };
  });
  return { client: { request, events: vi.fn() }, request, signal: new AbortController().signal };
}
describe("Remote Brain owner restart", () => {
  it("checks the actual capability and binds one mutation to the observed owner lifetime", async () => {
    const f = fixture();
    await restartRemoteBrain(f.client, "explicit/model", f.signal);
    expect(f.request.mock.calls.map(([route]) => route)).toEqual([
      "/__host/capabilities",
      "/__host/status",
      "/__host/restart",
    ]);
    expect(f.request).toHaveBeenLastCalledWith(
      "/__host/restart",
      { instanceId: "selected-owner-lifetime", modelId: "explicit/model" },
      f.signal,
    );
  });
  it.each([{ restart: false, writable: true }, { restart: true, writable: false }, {}])(
    "does not submit a mutation when the owner cannot explicitly restart",
    async (capabilities) => {
      const f = fixture();
      f.request.mockResolvedValue(capabilities);
      await expect(restartRemoteBrain(f.client, null, f.signal)).rejects.toThrow();
      expect(f.request).toHaveBeenCalledTimes(1);
    },
  );
  it("does not retry an unconfirmed lifetime acknowledgment", async () => {
    const f = fixture();
    f.request
      .mockResolvedValueOnce({ restart: true, writable: true })
      .mockResolvedValueOnce({ instanceId: "original" })
      .mockResolvedValueOnce({ accepted: true, instanceId: "replacement" });
    await expect(restartRemoteBrain(f.client, null, f.signal)).rejects.toThrow(
      "could not be confirmed",
    );
    expect(f.request).toHaveBeenCalledTimes(3);
  });
});
