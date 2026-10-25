import { expect, it, vi } from "vitest";
import type { KnowledgeStorageSetup } from "@getpaseo/plugin/otto/project-knowledge";
import { KnowledgeSetupModel } from "./setup-model";
const plan: KnowledgeStorageSetup = {
  revision: "a".repeat(64),
  required: true,
  label: "Fixture",
  otherStores: 2,
  candidates: [{ directoryName: "new", rootPath: "/owner/root" }],
};
type Result =
  | { ok: true; value: { directoryName: string | null } }
  | { ok: false; error: { message: string } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
function fixture(
  submit: () => Promise<Result> = async () => ({
    ok: true,
    value: { directoryName: "host-issued" },
  }),
) {
  const inspect = vi.fn(async () => ({ ok: true as const, value: plan }));
  const bind = vi.fn(submit);
  const changed = vi.fn();
  const model = new KnowledgeSetupModel({ inspect, bind, changed });
  model.activate();
  model.setActive(true);
  return { model, inspect, bind, changed };
}
it("inspects without choosing or allocating and submits the exact offered retained identity", async () => {
  const f = fixture();
  await f.model.inspect();
  await f.model.bind();
  expect(f.bind).not.toHaveBeenCalled();
  expect(f.model.getSnapshot().choice).toBeNull();
  f.model.choose("new"); // A real directory named new is never the new-store action.
  await f.model.bind();
  expect(f.bind).toHaveBeenCalledExactlyOnceWith({
    expectedRevision: plan.revision,
    choice: { kind: "retained", directoryName: "new" },
  });
  expect(f.changed).toHaveBeenCalledOnce();
});
it("keeps a new-store choice explicit and refuses arbitrary paths", async () => {
  const f = fixture();
  await f.model.inspect();
  f.model.choose("/client/path");
  await f.model.bind();
  expect(f.bind).not.toHaveBeenCalled();
  f.model.choose("__new__");
  await f.model.bind();
  expect(f.bind).toHaveBeenCalledExactlyOnceWith({
    expectedRevision: plan.revision,
    choice: { kind: "new" },
  });
});

it("can explicitly select Repository without inventing a host directory", async () => {
  const f = fixture(async () => ({ ok: true, value: { directoryName: null } }));
  await f.model.inspect();
  f.model.choose("__repository__");
  await f.model.bind();
  expect(f.bind).toHaveBeenCalledExactlyOnceWith({
    expectedRevision: plan.revision,
    choice: { kind: "repository" },
  });
  expect(f.changed).toHaveBeenCalledOnce();
});
it("serializes setup, retains a failed choice and blocks retry until a fresh inspection", async () => {
  const pending = deferred<Result>();
  const f = fixture(() => pending.promise);
  await f.model.inspect();
  f.model.choose("new");
  const attempt = f.model.bind();
  await f.model.bind();
  f.model.choose("__new__");
  pending.resolve({ ok: false, error: { message: "Changed ownership" } });
  await attempt;
  expect(f.model.getSnapshot()).toMatchObject({
    choice: { kind: "retained", directoryName: "new" },
    blocked: true,
    error: "Changed ownership",
  });
  await f.model.bind();
  expect(f.bind).toHaveBeenCalledOnce();
  await f.model.inspect();
  expect(f.model.getSnapshot()).toMatchObject({ choice: null, blocked: false });
});
it("invalidates confirmations after choice edits or hide/reactivation", async () => {
  const f = fixture();
  await f.model.inspect();
  f.model.choose("new");
  const edited = f.model.getAuthority();
  f.model.choose("__new__");
  await f.model.bind(edited);
  const hidden = f.model.getAuthority();
  f.model.setActive(false);
  f.model.setActive(true);
  await f.model.bind(hidden);
  expect(f.bind).not.toHaveBeenCalled();
});
it("does not adopt hidden acknowledgments or announce a hidden setup as completed", async () => {
  const pending = deferred<Result>();
  const f = fixture(() => pending.promise);
  await f.model.inspect();
  f.model.choose("__new__");
  const attempt = f.model.bind();
  f.model.setActive(false);
  f.model.setActive(true);
  pending.resolve({ ok: true, value: { directoryName: "owner-issued" } });
  await attempt;
  expect(f.model.getSnapshot()).toMatchObject({ choice: { kind: "new" }, blocked: true });
  expect(f.changed).not.toHaveBeenCalled();
});
it("retains unknown outcomes conservatively and ignores unmounted work", async () => {
  const f = fixture(async () => {
    throw new Error("private transport detail");
  });
  await f.model.inspect();
  f.model.choose("__new__");
  await f.model.bind();
  expect(f.model.getSnapshot().blocked).toBe(true);
  expect(f.model.getSnapshot().error).not.toContain("private transport");
  const pending = deferred<Result>();
  const closed = fixture(() => pending.promise);
  await closed.model.inspect();
  closed.model.choose("new");
  const attempt = closed.model.bind();
  closed.model.close();
  pending.resolve({ ok: true, value: { directoryName: "new" } });
  await attempt;
  expect(closed.changed).not.toHaveBeenCalled();
});
