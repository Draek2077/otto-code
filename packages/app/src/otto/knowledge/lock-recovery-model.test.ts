import { expect, it } from "vitest";
import type { KnowledgeLockInspection } from "@getpaseo/plugin/otto/project-knowledge";
import { KnowledgeLockRecoveryModel } from "./lock-recovery-model";

const plan: KnowledgeLockInspection = {
  revision: "a".repeat(64),
  state: "unverified",
  message: "Verify all writers",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const calls: unknown[] = [];
  let changed = 0;
  const model = new KnowledgeLockRecoveryModel({
    inspect: async () => ({ ok: true, value: plan }),
    recover: async (input) => {
      calls.push(input);
      return { ok: true, value: { recoveryName: ".recovered-fixture" } };
    },
    changed: () => {
      changed++;
    },
  });
  model.activate();
  model.setActive(true);
  return { model, calls, changed: () => changed };
}
it("never submits on open/inspection; pins explicit verified recovery to the inspected revision and reason", async () => {
  const f = fixture();
  expect(f.calls).toEqual([]);
  await f.model.inspect();
  await f.model.recover(async () => true);
  expect(f.calls).toEqual([]);
  f.model.setReason("  Verified all other writers stopped  ");
  f.model.verify(true);
  await f.model.recover(async () => false);
  expect(f.calls).toEqual([]);
  expect(f.model.getSnapshot().reason).toBe("  Verified all other writers stopped  ");
  await f.model.recover(async () => true);
  expect(f.calls).toEqual([
    {
      expectedRevision: plan.revision,
      reason: "Verified all other writers stopped",
      userVerifiedNoActiveWriter: true,
    },
  ]);
  expect(f.changed()).toBe(1);
  expect(f.model.getSnapshot()).toMatchObject({
    plan: null,
    reason: "",
    verified: false,
    busy: false,
    generation: 1,
  });
  await f.model.recover(async () => true);
  expect(f.calls).toHaveLength(1);
});
it.each(["unlocked", "busy", "unsupported"] as const)(
  "never submits an inspected %s lock",
  async (state) => {
    let calls = 0;
    const model = new KnowledgeLockRecoveryModel({
      inspect: async () => ({ ok: true, value: { ...plan, state } }),
      recover: async () => {
        calls++;
        return { ok: true, value: { recoveryName: "unused" } };
      },
      changed: () => {},
    });
    model.activate();
    model.setActive(true);
    await model.inspect();
    model.setReason("Reason");
    model.verify(true);
    await model.recover(async () => true);
    expect(calls).toBe(0);
  },
);
it("retains a failed draft, blocks retry, and requires a fresh inspection and renewed human verification", async () => {
  let calls = 0;
  const model = new KnowledgeLockRecoveryModel({
    inspect: async () => ({ ok: true, value: plan }),
    recover: async () => {
      calls++;
      return { ok: false, error: { message: "Changed lock" } };
    },
    changed: () => {},
  });
  model.activate();
  model.setActive(true);
  await model.inspect();
  model.setReason("Reason");
  model.verify(true);
  await model.recover(async () => true);
  await model.recover(async () => true);
  expect(calls).toBe(1);
  expect(model.getSnapshot()).toMatchObject({
    reason: "Reason",
    blocked: true,
    error: "Changed lock",
  });
  await model.inspect();
  expect(model.getSnapshot()).toMatchObject({ reason: "Reason", verified: false, blocked: false });
  await model.recover(async () => true);
  expect(calls).toBe(1);
});
it("invalidates confirmation after edits or hiding without submitting a write", async () => {
  const f = fixture();
  await f.model.inspect();
  f.model.setReason("Reason");
  f.model.verify(true);
  const confirmation = deferred<boolean>();
  const first = f.model.recover(() => confirmation.promise);
  f.model.setReason("Changed reason");
  confirmation.resolve(true);
  await first;
  expect(f.calls).toEqual([]);
  const hidden = deferred<boolean>();
  const second = f.model.recover(() => hidden.promise);
  f.model.setActive(false);
  f.model.setActive(true);
  hidden.resolve(true);
  await second;
  expect(f.calls).toEqual([]);
});
it("serializes writes and rejects hidden late acknowledgments without replaying recovery or publishing success", async () => {
  const pending = deferred<{ ok: true; value: { recoveryName: string } }>();
  let calls = 0;
  let changed = 0;
  const model = new KnowledgeLockRecoveryModel({
    inspect: async () => ({ ok: true, value: plan }),
    recover: async () => {
      calls++;
      return pending.promise;
    },
    changed: () => {
      changed++;
    },
  });
  model.activate();
  model.setActive(true);
  await model.inspect();
  model.setReason("Reason");
  model.verify(true);
  const first = model.recover(async () => true);
  await Promise.resolve();
  await model.recover(async () => true);
  expect(calls).toBe(1);
  model.setActive(false);
  model.setActive(true);
  pending.resolve({ ok: true, value: { recoveryName: "retained" } });
  await first;
  expect(model.getSnapshot()).toMatchObject({
    reason: "Reason",
    verified: false,
    blocked: true,
    busy: false,
    success: "",
  });
  expect(changed).toBe(0);
  await model.recover(async () => true);
  expect(calls).toBe(1);
});
it("ignores hidden inspection replies and handles confirmation failure before any host operation", async () => {
  const pending = deferred<{ ok: true; value: KnowledgeLockInspection }>();
  const model = new KnowledgeLockRecoveryModel({
    inspect: () => pending.promise,
    recover: async () => {
      throw new Error("Must not submit");
    },
    changed: () => {},
  });
  model.activate();
  model.setActive(true);
  const reading = model.inspect();
  model.setActive(false);
  model.setActive(true);
  pending.resolve({ ok: true, value: plan });
  await reading;
  expect(model.getSnapshot()).toMatchObject({ plan: null, busy: false });
  const f = fixture();
  await f.model.inspect();
  f.model.setReason("Reason");
  f.model.verify(true);
  await f.model.recover(async () => {
    throw new Error("Dialog unavailable");
  });
  expect(f.calls).toEqual([]);
  expect(f.model.getSnapshot().error).toContain("No recovery was submitted");
});
it("retains the reason on an unknown host outcome and ignores unmounted acknowledgments", async () => {
  let changed = 0;
  const model = new KnowledgeLockRecoveryModel({
    inspect: async () => ({ ok: true, value: plan }),
    recover: async () => {
      throw new Error("Transport disconnected");
    },
    changed: () => {
      changed++;
    },
  });
  model.activate();
  model.setActive(true);
  await model.inspect();
  model.setReason("Reason");
  model.verify(true);
  await model.recover(async () => true);
  expect(model.getSnapshot()).toMatchObject({
    reason: "Reason",
    blocked: true,
    verified: false,
    busy: false,
  });
  expect(changed).toBe(0);
  const pending = deferred<{ ok: true; value: { recoveryName: string } }>();
  const closed = new KnowledgeLockRecoveryModel({
    inspect: async () => ({ ok: true, value: plan }),
    recover: () => pending.promise,
    changed: () => {
      changed++;
    },
  });
  closed.activate();
  closed.setActive(true);
  await closed.inspect();
  closed.setReason("Reason");
  closed.verify(true);
  const writing = closed.recover(async () => true);
  await Promise.resolve();
  closed.close();
  pending.resolve({ ok: true, value: { recoveryName: "retained" } });
  await writing;
  expect(changed).toBe(0);
});
