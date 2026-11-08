import { expect, test, vi } from "vitest";
import { ScheduleOperation } from "./operation";
import { ScheduleRequestError } from "./api";
import { deferred } from "../workflows/test-fixtures";

test("confirmation grants no late authority after hiding; no operation starts", async () => {
  const lane = new ScheduleOperation(),
    release = lane.activate(),
    dialog = deferred<boolean>(),
    operation = vi.fn(async () => "saved"),
    apply = vi.fn();
  const pending = lane.run({ write: true, confirm: () => dialog.promise, operation, apply });
  release();
  lane.activate();
  dialog.resolve(true);
  await pending;
  expect(operation).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
  expect(lane.getSnapshot()).toMatchObject({ busy: false, blocked: false });
});
test("a pending write has one lane and its hidden outcome remains unconfirmed", async () => {
  const lane = new ScheduleOperation(),
    release = lane.activate(),
    held = deferred<string>(),
    apply = vi.fn(),
    duplicate = vi.fn(async () => "duplicate");
  const pending = lane.run({ write: true, operation: () => held.promise, apply });
  await lane.run({ write: true, operation: duplicate, apply });
  release();
  lane.activate();
  expect(lane.getSnapshot()).toMatchObject({ busy: true, writing: true, blocked: true });
  held.resolve("saved");
  await pending;
  expect(apply).not.toHaveBeenCalled();
  expect(duplicate).not.toHaveBeenCalled();
  expect(lane.getSnapshot()).toMatchObject({ busy: false, writing: false, blocked: true });
});

test("background reads have no write fence and release without claiming an unknown write", async () => {
  const lane = new ScheduleOperation(),
    release = lane.activate(),
    held = deferred<string>(),
    apply = vi.fn();
  const pending = lane.run({ operation: () => held.promise, apply });
  expect(lane.getSnapshot()).toMatchObject({ busy: true, writing: false, blocked: false });
  release();
  held.resolve("stale read");
  await pending;
  expect(apply).not.toHaveBeenCalled();
  expect(lane.getSnapshot()).toMatchObject({ busy: false, writing: false, blocked: false });
});
test("unconfirmed errors require an explicit inspected reload before another ordinary write", async () => {
  const lane = new ScheduleOperation();
  lane.activate();
  const apply = vi.fn();
  await lane.run({
    write: true,
    operation: async () => {
      throw new Error("private detail");
    },
    apply,
  });
  expect(lane.getSnapshot()).toMatchObject({
    blocked: true,
    error: "The host did not confirm this operation. Inspect the saved state before another write.",
  });
  const write = vi.fn(async () => "saved");
  await lane.run({ write: true, operation: write, apply });
  expect(write).not.toHaveBeenCalled();
  await lane.run({ operation: async () => "inspected", apply });
  expect(lane.getSnapshot().blocked).toBe(true);
  await lane.run({
    confirm: async () => true,
    operation: async () => "inspected",
    apply,
    inspected: true,
  });
  expect(lane.getSnapshot().blocked).toBe(false);
  await lane.run({ write: true, operation: write, apply });
  expect(write).toHaveBeenCalledTimes(1);
});
test("local unsent validation preserves editing, while a host failure never proves a safe retry", async () => {
  const lane = new ScheduleOperation();
  lane.activate();
  const apply = vi.fn();
  await lane.run({
    write: true,
    operation: async () => {
      throw new ScheduleRequestError("invalid", "local-validation", "Unsent");
    },
    apply,
  });
  expect(lane.getSnapshot().blocked).toBe(false);
  await lane.run({
    write: true,
    operation: async () => {
      throw new ScheduleRequestError("invalid", "host-reply", "Rejected");
    },
    apply,
  });
  expect(lane.getSnapshot().blocked).toBe(true);
});
