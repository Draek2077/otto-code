import { describe, test, expect, vi, afterEach } from "vitest";
import { WorkflowChanges } from "./changes.js";
const scope = { hostId: "h", projectId: "p" };
afterEach(() => vi.useRealTimers());
describe("demand-owned Workflow notifications", () => {
  test("idle construction has no timers; one subscribed scope receives its own revision", async () => {
    vi.useFakeTimers();
    const changes = new WorkflowChanges();
    expect(vi.getTimerCount()).toBe(0);
    const watching = changes.watch(scope, 0);
    expect(vi.getTimerCount()).toBe(1);
    changes.publish({ ...scope, projectId: "other" });
    expect(vi.getTimerCount()).toBe(1);
    changes.publish(scope);
    expect(await watching).toEqual({ version: 2 });
    expect(vi.getTimerCount()).toBe(0);
    changes.close();
  });
  test("unchanged demand expires and releases its timer without polling", async () => {
    vi.useFakeTimers();
    const changes = new WorkflowChanges();
    const watching = changes.watch(scope, 0);
    await vi.advanceTimersByTimeAsync(25000);
    expect(await watching).toEqual({ version: 0 });
    expect(vi.getTimerCount()).toBe(0);
    changes.close();
  });
  test("admission bounds and shutdown release all outstanding demand", async () => {
    vi.useFakeTimers();
    const changes = new WorkflowChanges();
    const watching = Array.from({ length: 32 }, () => changes.watch(scope, 0));
    await expect(changes.watch(scope, 0)).rejects.toMatchObject({ kind: "busy" });
    changes.close();
    await Promise.all(watching);
    expect(vi.getTimerCount()).toBe(0);
    await expect(changes.watch(scope, 0)).rejects.toMatchObject({ kind: "unavailable" });
  });
});
