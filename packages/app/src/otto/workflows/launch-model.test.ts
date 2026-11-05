import { test, expect, vi } from "vitest";
import { WorkflowLaunchForm } from "./launch-model";
import { entry, reviewed, deferred } from "./test-fixtures";
import type { WorkflowApi } from "./api";
type ReviewInput = Parameters<WorkflowApi["review"]>[0];
test("launch review captures runtime overrides without modifying its exact saved definition", async () => {
  const original = entry(),
    model = new WorkflowLaunchForm(original, "workspace"),
    release = model.activate();
  model.seat("worker", {
    provider: "other",
    model: "specific",
    providerLabel: "Other provider",
    modelLabel: "Captured label",
  });
  const review = vi.fn(async (input: ReviewInput) => reviewed(input.launch));
  await model.review({ review });
  const captured = review.mock.calls[0][0];
  expect(captured).toMatchObject({
    scope: original.ref.scope,
    workspaceId: "workspace",
    launch: {
      kind: "ai",
      definition: original.document.value,
      seats: { worker: { provider: "other", model: "specific" } },
      source: { ref: original.ref, revision: "origin" },
    },
  });
  expect(model.seatPicker("worker").getSnapshot().selection?.modelLabel).toBe("Captured label");
  release();
});
test("changing any reviewed limit invalidates the start token", async () => {
  const model = new WorkflowLaunchForm(entry(), "workspace"),
    release = model.activate();
  await model.review({ review: async (input) => reviewed(input.launch) });
  model.limit("maxAgents", "7");
  const start = vi.fn(async () => entry());
  expect(await model.start({ start })).toBeNull();
  expect(start).not.toHaveBeenCalled();
  release();
});
test("only one reviewed start is sent and hidden acknowledgment cannot navigate or retry", async () => {
  const model = new WorkflowLaunchForm(entry(), "workspace"),
    release = model.activate(),
    pending = deferred<ReturnType<typeof entry>>();
  await model.review({ review: async (input) => reviewed(input.launch) });
  const start = vi.fn(() => pending.promise),
    saving = model.start({ start });
  expect(await model.start({ start })).toBeNull();
  release();
  const active = model.activate();
  pending.resolve(entry());
  expect(await saving).toBeNull();
  expect(model.getSnapshot().blocked).toBe(true);
  expect(await model.start({ start })).toBeNull();
  expect(start).toHaveBeenCalledOnce();
  active();
});
test("seat picker snapshots remain referentially stable until an actual selection or busy change", () => {
  const model = new WorkflowLaunchForm(entry(), "workspace"),
    picker = model.seatPicker("conductor"),
    first = picker.getSnapshot();
  expect(picker.getSnapshot()).toBe(first);
  model.limit("maxAgents", "9");
  expect(picker.getSnapshot()).toBe(first);
});
test("unavailable provider review preserves seats and allows explicit correction without starting", async () => {
  const model = new WorkflowLaunchForm(entry(), "workspace"),
    release = model.activate();
  await model.review({
    review: async () => {
      throw new Error("Model is unavailable");
    },
  });
  expect(model.getSnapshot()).toMatchObject({
    error: "Model is unavailable",
    blocked: false,
    review: null,
    seats: { worker: { provider: "fixture", model: "model" } },
  });
  release();
});
