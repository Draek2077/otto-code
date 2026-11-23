import { expect, it, vi } from "vitest";
import type { KnowledgeFormatPlan } from "@getpaseo/plugin/otto/project-knowledge";
import { KnowledgeFormatModel } from "./format-model";
const plan: KnowledgeFormatPlan = {
  revision: "a".repeat(64),
  required: true,
  count: 2,
  omitted: 0,
  recoveryPath: "/owner/recovery",
  changes: [],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const inspect = vi.fn(async () => ({ ok: true as const, value: plan }));
  const apply = vi.fn(async (_input: { expectedRevision: string; reason: string }) => ({
    ok: true as const,
    value: { converted: 2, recoveryPath: "/owner/recovery" },
  }));
  const changed = vi.fn();
  const model = new KnowledgeFormatModel({ inspect, apply, changed });
  model.activate();
  model.setActive(true);
  return { model, inspect, apply, changed };
}
it("inspects without submitting a conversion and uses the captured origin only for an explicit apply", async () => {
  const f = fixture();
  await f.model.inspect();
  expect(f.apply).not.toHaveBeenCalled();
  f.model.setReason("  Human approved conversion  ");
  await f.model.apply();
  expect(f.apply).toHaveBeenCalledExactlyOnceWith({
    expectedRevision: plan.revision,
    reason: "Human approved conversion",
  });
  expect(f.model.getSnapshot()).toMatchObject({
    plan: null,
    reason: "",
    busy: false,
    error: "",
    success: expect.stringContaining("2 records converted"),
  });
  expect(f.changed).toHaveBeenCalledOnce();
  await f.model.apply();
  expect(f.apply).toHaveBeenCalledOnce();
});
it("serializes pending writes and retains a failed draft without retrying or rebasing", async () => {
  const pending = deferred<{ ok: false; error: { message: string } }>();
  const apply = vi.fn(() => pending.promise);
  const model = new KnowledgeFormatModel({
    inspect: async () => ({ ok: true, value: plan }),
    apply,
    changed: vi.fn(),
  });
  model.activate();
  model.setActive(true);
  await model.inspect();
  model.setReason("Keep this reason");
  const saving = model.apply();
  await model.apply();
  await model.inspect();
  model.setReason("Must not replace an in-flight reason");
  expect(apply).toHaveBeenCalledOnce();
  pending.resolve({ ok: false, error: { message: "A peer changed the store" } });
  await saving;
  expect(model.getSnapshot()).toMatchObject({
    blocked: true,
    reason: "Keep this reason",
    plan,
    error: "A peer changed the store",
  });
  await model.apply();
  expect(apply).toHaveBeenCalledOnce();
  await model.inspect();
  expect(model.getSnapshot()).toMatchObject({ blocked: false, reason: "", plan });
});
it("invalidates delayed confirmation authority and ignores a stale hidden inspection", async () => {
  const pending = deferred<{ ok: true; value: KnowledgeFormatPlan }>();
  const apply = vi.fn();
  const model = new KnowledgeFormatModel({
    inspect: () => pending.promise,
    apply,
    changed: vi.fn(),
  });
  model.activate();
  model.setActive(true);
  const authority = model.getAuthority();
  const reading = model.inspect();
  model.setActive(false);
  model.setActive(true);
  pending.resolve({ ok: true, value: plan });
  await reading;
  expect(model.getSnapshot().plan).toBeNull();
  await model.apply(authority);
  expect(apply).not.toHaveBeenCalled();
});

it.each(["rejected", "returned"])(
  "retains the draft and blocks an old preview after a failed explicit reinspection (%s)",
  async (mode) => {
    let failed = false;
    const apply = vi.fn();
    const model = new KnowledgeFormatModel({
      inspect: async () => {
        if (failed) {
          if (mode === "rejected") throw new Error("Read failed");
          return { ok: false, error: { message: "Read failed" } };
        }
        return { ok: true, value: plan };
      },
      apply,
      changed: vi.fn(),
    });
    model.activate();
    model.setActive(true);
    await model.inspect();
    model.setReason("Retained reason");
    failed = true;
    await model.inspect();
    await model.apply();
    expect(model.getSnapshot()).toMatchObject({ blocked: true, reason: "Retained reason", plan });
    expect(apply).not.toHaveBeenCalled();
  },
);

it("invalidates an older confirmation when an explicit fresh preview is accepted", async () => {
  const f = fixture();
  await f.model.inspect();
  f.model.setReason("Original reason");
  const authority = f.model.getAuthority();
  await f.model.inspect();
  f.model.setReason("New inspection reason");
  await f.model.apply(authority);
  expect(f.apply).not.toHaveBeenCalled();
  expect(f.model.getSnapshot().reason).toBe("New inspection reason");
});
it.each([true, false])(
  "a hidden in-flight conversion preserves its reason and requires inspection (success=%s)",
  async (success) => {
    const pending = deferred<{ ok: true; value: { converted: number; recoveryPath: string } }>();
    const changed = vi.fn();
    const model = new KnowledgeFormatModel({
      inspect: async () => ({ ok: true, value: plan }),
      apply: () => pending.promise,
      changed,
    });
    model.activate();
    model.setActive(true);
    await model.inspect();
    model.setReason("Retained reason");
    const saving = model.apply();
    model.setActive(false);
    model.setActive(true);
    if (success)
      pending.resolve({ ok: true, value: { converted: 2, recoveryPath: "/owner/recovery" } });
    else pending.reject(new Error("No known outcome"));
    await saving;
    expect(model.getSnapshot()).toMatchObject({
      blocked: true,
      busy: false,
      reason: "Retained reason",
      success: "",
    });
    expect(changed).not.toHaveBeenCalled();
  },
);
