import { expect, test } from "vitest";
import { WorkflowSettlement } from "./settlement.js";
test("Planning remains pending until final owner cleanup completes", async () => {
  const settlement = new WorkflowSettlement();
  let finished = false;
  const pending = settlement.wait().then(() => {
    finished = true;
    return undefined;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  settlement.complete();
  await pending;
  expect(finished).toBe(true);
  await expect(settlement.wait()).resolves.toBeUndefined();
});
test("aborted waiters release demand without settling or canceling the owner", async () => {
  const settlement = new WorkflowSettlement();
  for (let index = 0; index < 20; index++) {
    const controller = new AbortController();
    const pending = settlement.wait(controller.signal).catch((error) => error);
    const reason = new Error("Leave page");
    controller.abort(reason);
    expect(await pending).toBe(reason);
  }
  let finished = false;
  const remaining = settlement.wait().then(() => {
    finished = true;
    return undefined;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  settlement.complete();
  await remaining;
});
test("cleanup failure is retained for current and later observers without an unhandled rejection", async () => {
  const settlement = new WorkflowSettlement();
  const failure = new Error("Recovery required");
  const pending = settlement.wait().catch((error) => error);
  settlement.fail(failure);
  expect(await pending).toBe(failure);
  await expect(settlement.wait()).rejects.toBe(failure);
  settlement.complete();
  await expect(settlement.wait()).rejects.toBe(failure);
});
test("settlement observer capacity is bounded and cleanup releases every slot", async () => {
  const settlement = new WorkflowSettlement();
  const pending = Array.from({ length: 16 }, () => settlement.wait());
  expect(() => settlement.wait()).toThrow("Too many observers");
  settlement.complete();
  await Promise.all(pending);
  await expect(settlement.wait()).resolves.toBeUndefined();
});
