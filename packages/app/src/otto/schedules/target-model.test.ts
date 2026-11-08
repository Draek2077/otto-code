import { expect, test, vi } from "vitest";
import { ScheduleTargetCandidate } from "@getpaseo/plugin/otto/schedules";
import { ScheduleTargetModel } from "./target-model";
import { entry } from "../workflows/test-fixtures";

test("AI selection preserves saved seats, limits and origin without inventing a workspace or launching", () => {
  const changed = vi.fn(),
    model = new ScheduleTargetModel(changed, () => true, null, ""),
    original = entry();
  if (original.document.kind !== "ai") throw new Error("Expected saved AI definition");
  model.workflow(original, "Captured title");
  expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({
    type: "workflow",
    source: original.ref,
    workspaceId: "",
    seats: original.document.value.seats,
    limits: original.document.value.limits,
    approval: { allowTemplateCode: false, allowQueryEffects: false },
  });
  model.workspace("explicit-workspace");
  model.seatOption("worker", "modeId", "safe-mode");
  model.allow("allowTemplateCode", true);
  const candidate = ScheduleTargetCandidate.parse(changed.mock.calls.at(-1)?.[0]);
  expect(candidate).toMatchObject({
    workspaceId: "explicit-workspace",
    seats: { worker: { modeId: "safe-mode" } },
    approval: { allowTemplateCode: true },
  });
  expect(original.document.value).not.toHaveProperty("workspaceId");
  expect(model.getSnapshot().label).toBe("Captured title");
});
test("explicit Artifact model is mandatory for instructions; data never implies HTML regeneration", () => {
  const changed = vi.fn(),
    model = new ScheduleTargetModel(changed, () => true, null, "");
  const ref = {
    scope: { hostId: "host", target: { kind: "workspace" as const, id: "workspace" } },
    id: "artifact",
    location: "host" as const,
  };
  model.artifact(ref, "Captured Artifact");
  model.artifactText('{"value":7}');
  expect(changed.mock.calls.at(-1)?.[0]).toEqual({
    type: "artifact-update",
    source: ref,
    update: { type: "data", json: '{"value":7}' },
  });
  model.artifactMode("instruction");
  expect(changed.mock.calls.at(-1)?.[0]).toBeNull();
  model.picker("artifact").selectModel({
    provider: "explicit",
    model: "exact",
    providerLabel: "Provider label",
    modelLabel: "Model label",
  });
  expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({
    update: { type: "instruction", selection: { provider: "explicit", model: "exact" } },
  });
  model.clearArtifact();
  expect(changed.mock.calls.at(-1)?.[0]).toBeNull();
});
test("picker snapshots are stable and captured labels survive unrelated intent edits", () => {
  const model = new ScheduleTargetModel(vi.fn(), () => true, null, "");
  model.workflow(entry(), "Original");
  const picker = model.picker("worker"),
    before = picker.getSnapshot();
  expect(picker.getSnapshot()).toBe(before);
  model.limit("maxAgents", 7);
  expect(picker.getSnapshot()).toBe(before);
  picker.selectModel({
    provider: "other",
    model: "selected",
    providerLabel: "Captured provider",
    modelLabel: "Captured model",
  });
  const after = picker.getSnapshot();
  expect(after.selection?.modelLabel).toBe("Captured model");
  expect(picker.getSnapshot()).toBe(after);
});
