import { describe, test, expect } from "vitest";
import { WorkflowSlots } from "./run-state.js";
import { WorkflowTurnLease } from "./turn-lease.js";
import { deferred } from "./test-utils/host-fixture.js";
describe("managed delegation turn capacity", () => {
  test("capacity one parent yields to a child, then reacquires before returning", async () => {
    const global = new WorkflowSlots(1),
      run = new WorkflowSlots(1),
      signal = new AbortController().signal;
    const parent = new WorkflowTurnLease(global, run, signal),
      child = new WorkflowTurnLease(global, run, signal);
    await parent.acquire();
    let worked = false;
    await parent.whileWaiting(async () => {
      await child.acquire();
      worked = true;
      child.close();
    });
    expect(worked).toBe(true);
    parent.close();
    await child.acquire();
    child.close();
  });
  test("concurrent delegation cannot double-release or bypass capacity", async () => {
    const lease = new WorkflowTurnLease(
      new WorkflowSlots(1),
      new WorkflowSlots(1),
      new AbortController().signal,
    );
    await lease.acquire();
    const hold = deferred<void>();
    const pending = lease.whileWaiting(() => hold.promise);
    await expect(lease.whileWaiting(async () => {})).rejects.toMatchObject({ kind: "busy" });
    hold.resolve();
    await pending;
    lease.close();
  });
  test("a failed child restores parent capacity before propagating its error", async () => {
    const signal = new AbortController().signal;
    const proper = new WorkflowTurnLease(new WorkflowSlots(1), new WorkflowSlots(1), signal);
    await proper.acquire();
    await expect(
      proper.whileWaiting(async () => {
        throw new Error("Child");
      }),
    ).rejects.toThrow("Child");
    proper.close();
  });
  test("cancel during a yielded turn does not reacquire or retain a lane", async () => {
    const global = new WorkflowSlots(1),
      run = new WorkflowSlots(1),
      abort = new AbortController();
    const lease = new WorkflowTurnLease(global, run, abort.signal);
    await lease.acquire();
    await lease.whileWaiting(async () => {
      abort.abort();
    });
    lease.close();
    const replacement = new WorkflowTurnLease(global, run, new AbortController().signal);
    await replacement.acquire();
    replacement.close();
  });
});
