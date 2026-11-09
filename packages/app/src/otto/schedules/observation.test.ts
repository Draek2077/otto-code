import { QueryClient } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { ScheduleRequestError } from "./api";
import { retryScheduleObservation } from "./observation";

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
