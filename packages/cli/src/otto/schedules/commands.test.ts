import { expect, test, vi } from "vitest";
import * as rpc from "@getpaseo/plugin/otto/schedules";
import {
  createOwnedScheduleCommand,
  runOwnedScheduleRequest,
  type ScheduleCliClient,
} from "./commands.js";
import type { DaemonTarget } from "../../utils/daemon-target.js";

const target: DaemonTarget = { kind: "endpoint", host: "fixture.invalid" };
const scope = { hostId: "host", projectId: "project" };
function client(
  value: unknown = { ok: true, value: { location: "host", revision: "a".repeat(64) } },
) {
  return {
    getLastServerInfoMessage: () => ({ serverId: "host", features: { scheduleTargets: true } }),
    invokePluginRpc: vi.fn<ScheduleCliClient["invokePluginRpc"]>(async () => value),
    close: vi.fn(async () => {}),
  };
}
test("all owned operations are reachable without replacing any original agent command", () => {
  const root = createOwnedScheduleCommand();
  expect(root.name()).toBe("targets");
  expect(
    root.commands
      .filter((command) => command.name() !== "operations")
      .map((command) => command.description())
      .sort(),
  ).toEqual(rpc.scheduleOperations.map((operation) => operation.name).sort());
  expect(root.commands.find((command) => command.name() === "create")?.helpInformation()).toContain(
    "--approved",
  );
});
test("project and host scope go unchanged through the selected transport, which always closes", async () => {
  const c = client();
  expect(
    await runOwnedScheduleRequest(
      target,
      rpc.readScheduleDefaults.name,
      { hostId: "host" },
      false,
      async () => c,
    ),
  ).toMatchObject({ location: "host" });
  expect(c.invokePluginRpc).toHaveBeenCalledWith("otto-schedules", rpc.readScheduleDefaults.name, {
    hostId: "host",
  });
  expect(c.close).toHaveBeenCalledTimes(1);
});
test("write intent is explicit and cannot connect or mutate before approval", async () => {
  const c = client(),
    connect = vi.fn(async () => c);
  await expect(
    runOwnedScheduleRequest(
      target,
      rpc.saveScheduleDefaults.name,
      { hostId: "host", expectedRevision: "a".repeat(64), location: "host" },
      false,
      connect,
    ),
  ).rejects.toThrow("--approved");
  expect(connect).not.toHaveBeenCalled();
  expect(c.invokePluginRpc).not.toHaveBeenCalled();
});
test("unavailable capabilities and another host cannot be silently redirected", async () => {
  const c = client();
  await expect(
    runOwnedScheduleRequest(
      target,
      rpc.listSchedules.name,
      { scope: { ...scope, hostId: "other" } },
      false,
      async () => c,
    ),
  ).rejects.toThrow("another owning host");
  expect(c.invokePluginRpc).not.toHaveBeenCalled();
  expect(c.close).toHaveBeenCalledTimes(1);
  const old = { ...c, getLastServerInfoMessage: () => ({ serverId: "host", features: {} }) };
  await expect(
    runOwnedScheduleRequest(target, rpc.listSchedules.name, { scope }, false, async () => old),
  ).rejects.toThrow("Update the selected host");
  expect(c.invokePluginRpc).not.toHaveBeenCalled();
  expect(c.close).toHaveBeenCalledTimes(2);
});
test("lost writes are never replayed and malformed control success is not accepted", async () => {
  const c = client({ ok: true, value: {} }),
    input = {
      ref: { scope, id: "schedule", location: "repository", storeKey: "repository:project" },
      expectedRevision: "a".repeat(64),
      command: { type: "delete" },
    };
  await expect(
    runOwnedScheduleRequest(target, rpc.controlSchedule.name, input, true, async () => c),
  ).rejects.toThrow("did not confirm this exact");
  c.invokePluginRpc.mockRejectedValueOnce(new Error("private socket details"));
  await expect(
    runOwnedScheduleRequest(target, rpc.controlSchedule.name, input, true, async () => c),
  ).rejects.toThrow("not acknowledged");
  expect(c.invokePluginRpc).toHaveBeenCalledTimes(2);
  expect(c.close).toHaveBeenCalledTimes(2);
});
