import { expect, test, vi } from "vitest";
import { z } from "zod";
import { runArtifactRequest, createArtifactsCommand } from "./commands.js";
import type { DaemonTarget } from "../../utils/daemon-target.js";
const target: DaemonTarget = { kind: "endpoint", host: "ws://fixture.invalid" };
function client(supported = true) {
  return {
    getLastServerInfoMessage: () => ({
      serverId: "remote-owner",
      features: { ottoArtifacts: supported },
    }),
    invokePluginRpc: vi.fn(async () => ({ ok: true, value: { acknowledged: true } })),
    close: vi.fn(async () => {}),
  };
}
test("CLI requests bind to the selected daemon identity and close only their own connection", async () => {
  const host = client(),
    build = vi.fn(async (hostId: string) => ({
      method: "artifacts.test.request",
      input: { hostId },
      output: z.object({ ok: z.literal(true), value: z.object({ acknowledged: z.boolean() }) }),
    }));
  expect(await runArtifactRequest(target, build, async () => host)).toEqual({ acknowledged: true });
  expect(build).toHaveBeenCalledWith("remote-owner");
  expect(host.invokePluginRpc).toHaveBeenCalledWith("otto-artifacts", "artifacts.test.request", {
    hostId: "remote-owner",
  });
  expect(host.close).toHaveBeenCalledOnce();
});
test("old hosts receive no Artifacts operation", async () => {
  const host = client(false);
  await expect(
    runArtifactRequest(
      target,
      async () => {
        throw new Error("must not build");
      },
      async () => host,
    ),
  ).rejects.toThrow("Update");
  expect(host.invokePluginRpc).not.toHaveBeenCalled();
  expect(host.close).toHaveBeenCalledOnce();
});
test("command definitions expose lifecycle and design-preserving operations without effects", () => {
  expect(createArtifactsCommand().commands.map((command) => command.name())).toEqual([
    "ls",
    "inspect",
    "create",
    "data",
    "metadata",
    "cancel",
    "regenerate",
    "repair",
    "delete",
    "move",
    "storage",
  ]);
});
