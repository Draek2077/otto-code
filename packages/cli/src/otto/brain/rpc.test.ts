import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { runBrainRequest, type BrainCliClient } from "./rpc.js";

const target = { kind: "endpoint", host: "pairing://selected-host" } as const;
const request = {
  method: "brain.query",
  input: { resource: "catalog" },
  output: z.object({ models: z.array(z.object({ id: z.string() })) }),
};
function fixture(value: unknown, feature = true) {
  const client: BrainCliClient = {
    getLastServerInfoMessage: () => ({ features: { ottoBrain: feature } }),
    invokePluginRpc: vi.fn().mockResolvedValue(value),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { client, connect: vi.fn().mockResolvedValue(client) };
}

describe("selected-daemon Brain CLI channel", () => {
  it("uses the exact selected daemon, strips unknown response fields and closes only its client", async () => {
    const { client, connect } = fixture({
      ok: true,
      value: { models: [{ id: "actual-model", accessKey: "private" }], credentials: "private" },
    });
    expect(await runBrainRequest(target, request, connect)).toEqual({
      models: [{ id: "actual-model" }],
    });
    expect(connect).toHaveBeenCalledExactlyOnceWith(target);
    expect(client.invokePluginRpc).toHaveBeenCalledExactlyOnceWith(
      "otto-brain",
      "brain.query",
      request.input,
    );
    expect(client.close).toHaveBeenCalledTimes(1);
  });
  it("requires the Brain capability before invoking the plugin", async () => {
    const { client, connect } = fixture(null, false);
    await expect(runBrainRequest(target, request, connect)).rejects.toMatchObject({
      code: "DAEMON_UPDATE_REQUIRED",
    });
    expect(client.invokePluginRpc).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledTimes(1);
  });
  it.each(["validation", "conflict", "unavailable", "unknown"] as const)(
    "retains %s classification without echoing untrusted host text",
    async (kind) => {
      const { client, connect } = fixture({
        ok: false,
        error: { kind, message: "private-credential" },
      });
      const failure = await runBrainRequest(target, request, connect).catch(
        (error: unknown) => error,
      );
      expect(failure).toMatchObject({ code: `BRAIN_${kind.toUpperCase()}` });
      expect(String(failure)).not.toContain("private-credential");
      expect(client.close).toHaveBeenCalledTimes(1);
    },
  );
  it.each([{ arbitrary: "private" }, { ok: true, value: { models: "private" } }])(
    "rejects unsupported data without reflecting it",
    async (value) => {
      const { client, connect } = fixture(value);
      await expect(runBrainRequest(target, request, connect)).rejects.toMatchObject({
        code: "BRAIN_RESPONSE_INVALID",
      });
      expect(client.close).toHaveBeenCalledTimes(1);
    },
  );
  it("reports an unconfirmed transport outcome once and never retries the mutation", async () => {
    const { client, connect } = fixture(null);
    vi.mocked(client.invokePluginRpc).mockRejectedValue(new Error("private-credential"));
    const failure = await runBrainRequest(target, request, connect).catch(
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ code: "BRAIN_UNCONFIRMED" });
    expect(String(failure)).not.toContain("private-credential");
    expect(client.invokePluginRpc).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
  });
});
