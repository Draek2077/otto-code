import { QueryClient } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { ScheduleRequestError } from "./api";
import { observeScheduleVersion, retryScheduleObservation } from "./observation";

test("filter loading retains its scope cursor, while host/project switches never inherit it", () => {
  const scope = { hostId: "host", projectId: "project" };
  const first = observeScheduleVersion(undefined, scope, 20);
  expect(observeScheduleVersion(first, scope, undefined).version).toBe(20);
  expect(
    observeScheduleVersion(first, { ...scope, projectId: "other" }, undefined).version,
  ).toBeUndefined();
  expect(observeScheduleVersion(first, { ...scope, hostId: "other" }, 2).version).toBe(2);
  expect(
    observeScheduleVersion(first, { ...scope, projectId: null }, undefined).version,
  ).toBeUndefined();
});
test("an authoritative lower page cursor after daemon restart is not floored by old state", () => {
  const scope = { hostId: "host", projectId: "project" };
  const old = observeScheduleVersion(undefined, scope, 50);
  const restarted = observeScheduleVersion(old, scope, 0);
  expect(restarted.version).toBe(0);
  expect(observeScheduleVersion(restarted, scope, undefined).version).toBe(0);
});

async function query(operation: () => Promise<string>) {
  const client = new QueryClient();
  try {
    return await client.fetchQuery({
      queryKey: ["schedule-observation"],
      queryFn: operation,
      retry: retryScheduleObservation,
      retryDelay: 0,
    });
  } finally {
    client.clear();
  }
}
test("canonical read query recovers a bounded atomic publication race", async () => {
  const busy = new ScheduleRequestError("busy", "host-reply", "Storage is changing");
  const read = vi
    .fn<() => Promise<string>>()
    .mockRejectedValueOnce(busy)
    .mockRejectedValueOnce(busy)
    .mockResolvedValue("settled history");
  expect(await query(read)).toBe("settled history");
  expect(read).toHaveBeenCalledTimes(3);
});
test("persistent busy stops after three read attempts", async () => {
  const busy = new ScheduleRequestError("busy", "host-reply", "Storage is changing");
  const read = vi.fn<() => Promise<string>>().mockRejectedValue(busy);
  await expect(query(read)).rejects.toBe(busy);
  expect(read).toHaveBeenCalledTimes(3);
});
test.each([
  new ScheduleRequestError("conflict", "host-reply", "Origin changed"),
  new ScheduleRequestError("unavailable", "host-reply", "Host unavailable"),
  new ScheduleRequestError("busy", "transport", "Unconfirmed response"),
  new ScheduleRequestError("busy", "response-validation", "Invalid response"),
  new Error("Unknown failure"),
])("other failures remain explicit and are never replayed: %s", async (error) => {
  const read = vi.fn<() => Promise<string>>().mockRejectedValue(error);
  await expect(query(read)).rejects.toBe(error);
  expect(read).toHaveBeenCalledTimes(1);
});
