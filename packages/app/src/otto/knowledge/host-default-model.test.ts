import { expect, it, vi } from "vitest";
import type { KnowledgeHostDefaults } from "@getpaseo/plugin/otto/project-knowledge";
import { KnowledgeHostDefaultModel } from "./host-default-model";
const origin: KnowledgeHostDefaults = {
  revision: "a".repeat(64),
  defaultStoreLocation: "repository",
};
const saved: KnowledgeHostDefaults = { revision: "b".repeat(64), defaultStoreLocation: "host" };
type Outcome =
  | { ok: true; value: KnowledgeHostDefaults }
  | { ok: false; error: { message: string } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
async function fixture(
  saveResult: () => Promise<Outcome> = async () => ({ ok: true, value: saved }),
) {
  const read = vi.fn(async (): Promise<Outcome> => ({ ok: true, value: origin }));
  const save = vi.fn(saveResult);
  const changed = vi.fn();
  const model = new KnowledgeHostDefaultModel({ read, save, changed });
  model.activate();
  model.setActive(true);
  await model.reload();
  return { model, read, save, changed };
}
it("reads on active demand and submits only an explicit changed selection with its captured revision", async () => {
  const f = await fixture();
  expect(f.read).toHaveBeenCalledOnce();
  expect(f.save).not.toHaveBeenCalled();
  await f.model.save();
  expect(f.save).not.toHaveBeenCalled();
  f.model.select("host");
  await f.model.save();
  expect(f.save).toHaveBeenCalledExactlyOnceWith({
    expectedRevision: origin.revision,
    defaultStoreLocation: "host",
  });
  expect(f.model.getSnapshot()).toMatchObject({ origin: saved, location: "host", blocked: false });
  expect(f.changed).toHaveBeenCalledOnce();
});
it("serializes writes and retains the selection on conflict without automatic retry or rebase", async () => {
  const pending = deferred<Outcome>();
  const f = await fixture(() => pending.promise);
  f.model.select("host");
  const attempt = f.model.save();
  await f.model.save();
  f.model.select("repository");
  expect(f.model.getSnapshot().location).toBe("host");
  pending.resolve({ ok: false, error: { message: "Reload changed settings" } });
  await attempt;
  await f.model.save();
  expect(f.save).toHaveBeenCalledOnce();
  expect(f.model.getSnapshot()).toMatchObject({
    origin,
    location: "host",
    blocked: true,
    error: "Reload changed settings",
  });
  expect(f.changed).not.toHaveBeenCalled();
  await f.model.reload();
  expect(f.model.getSnapshot()).toMatchObject({ origin, location: "repository", blocked: false });
});
it("invalidates a captured confirmation after hiding without submitting its write", async () => {
  const f = await fixture();
  f.model.select("host");
  const authority = f.model.getAuthority();
  f.model.setActive(false);
  f.model.setActive(true);
  await f.model.save(authority);
  expect(f.save).not.toHaveBeenCalled();
});
it("does not adopt hidden write acknowledgments or publish callbacks after reactivation", async () => {
  const pending = deferred<Outcome>();
  const f = await fixture(() => pending.promise);
  f.model.select("host");
  const attempt = f.model.save();
  f.model.setActive(false);
  f.model.setActive(true);
  pending.resolve({ ok: true, value: saved });
  await attempt;
  expect(f.model.getSnapshot()).toMatchObject({
    origin,
    location: "host",
    blocked: true,
    busy: false,
  });
  expect(f.changed).not.toHaveBeenCalled();
  await f.model.save();
  expect(f.save).toHaveBeenCalledOnce();
});
it("leaves failed reads and unknown writes blocked, retaining editable local selection until explicit reload", async () => {
  const f = await fixture(async () => {
    throw new Error("private transport failure");
  });
  f.model.select("host");
  await f.model.save();
  expect(f.model.getSnapshot()).toMatchObject({ origin, location: "host", blocked: true });
  expect(f.model.getSnapshot().error).not.toContain("private transport");
  f.read.mockResolvedValueOnce({ ok: false, error: { message: "Unavailable" } });
  await f.model.reload();
  expect(f.model.getSnapshot()).toMatchObject({
    origin,
    location: "host",
    blocked: true,
    error: "Unavailable",
  });
  await f.model.reload();
  expect(f.model.getSnapshot()).toMatchObject({ location: "repository", blocked: false });
});
it("ignores closed reads and suppresses closed write callbacks", async () => {
  const pending = deferred<Outcome>();
  const changed = vi.fn();
  const model = new KnowledgeHostDefaultModel({
    read: () => pending.promise,
    save: async () => ({ ok: true, value: saved }),
    changed,
  });
  model.activate();
  model.setActive(true);
  model.close();
  pending.resolve({ ok: true, value: origin });
  await pending.promise;
  expect(model.getSnapshot().origin).toBeNull();
  const writing = deferred<Outcome>();
  const f = await fixture(() => writing.promise);
  f.model.select("host");
  const attempt = f.model.save();
  f.model.close();
  writing.resolve({ ok: true, value: saved });
  await attempt;
  expect(f.changed).not.toHaveBeenCalled();
});
