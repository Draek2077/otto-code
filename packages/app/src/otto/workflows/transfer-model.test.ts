import { test, expect, vi } from "vitest";
import { WorkflowTransferForm } from "./transfer-model";
import { entry, reference, deferred } from "./test-fixtures";
const receipt = {
  id: "receipt",
  source: reference,
  destination: { ...reference, location: "host" as const },
  operation: "copy" as const,
  status: "committed" as const,
  message: "Verified",
};
test("duplicate transfer is fenced at admission and accepted operation never replays", async () => {
  const pending = deferred<typeof receipt>();
  const api = { read: vi.fn(async () => entry()), transfer: vi.fn(() => pending.promise) };
  const model = new WorkflowTransferForm(reference);
  model.activate();
  const first = model.transfer(api, async () => true);
  await vi.waitFor(() => expect(api.transfer).toHaveBeenCalledTimes(1));
  await model.transfer(api, async () => true);
  pending.resolve(receipt);
  await first;
  await model.transfer(api, async () => true);
  expect(api.transfer).toHaveBeenCalledTimes(1);
  expect(model.getSnapshot().attempted).toBe(true);
});
test("hidden write keeps its operation identity and requires inspection without late acknowledgment", async () => {
  const pending = deferred<typeof receipt>();
  const api = { read: vi.fn(async () => entry()), transfer: vi.fn(() => pending.promise) };
  const model = new WorkflowTransferForm(reference);
  const hide = model.activate();
  const id = model.getSnapshot().operationId;
  const write = model.transfer(api, async () => true);
  await vi.waitFor(() => expect(api.transfer).toHaveBeenCalledTimes(1));
  hide();
  model.activate();
  pending.resolve(receipt);
  await write;
  expect(model.getSnapshot()).toMatchObject({ operationId: id, attempted: true, message: "" });
  expect(model.getSnapshot().error).toContain("Inspect");
});
test("late confirmation cannot start a transfer after hidden reactivation", async () => {
  const confirmation = deferred<boolean>();
  const api = { read: vi.fn(async () => entry()), transfer: vi.fn(async () => receipt) };
  const model = new WorkflowTransferForm(reference);
  const hide = model.activate();
  const write = model.transfer(api, () => confirmation.promise);
  await Promise.resolve();
  hide();
  model.activate();
  confirmation.resolve(true);
  await write;
  expect(api.transfer).not.toHaveBeenCalled();
});
