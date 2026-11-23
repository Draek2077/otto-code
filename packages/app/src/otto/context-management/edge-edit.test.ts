import { expect, test, vi } from "vitest";
import { ContextEdgeEdit } from "./edge-edit";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
test("declined and hidden confirmations never dispatch a source write", async () => {
  const model = new ContextEdgeEdit();
  const release = model.activate(),
    confirmation = deferred<boolean>();
  const write = vi.fn(async () => ({ ok: true as const }));
  const task = model.change(
    () => confirmation.promise,
    write,
    () => {},
  );
  release();
  model.activate();
  confirmation.resolve(true);
  await task;
  expect(write).not.toHaveBeenCalled();
  expect(model.getSnapshot().busy).toBe(false);
  await model.change(
    async () => false,
    write,
    () => {},
  );
  expect(write).not.toHaveBeenCalled();
});
test("duplicate clicks serialize and a confirmed result blocks replay", async () => {
  const model = new ContextEdgeEdit();
  model.activate();
  const result = deferred<{ ok: true }>(),
    write = vi.fn(() => result.promise),
    changed = vi.fn();
  const task = model.change(async () => true, write, changed);
  await Promise.resolve();
  await model.change(async () => true, write, changed);
  expect(write).toHaveBeenCalledTimes(1);
  result.resolve({ ok: true });
  await task;
  expect(changed).toHaveBeenCalledTimes(1);
  expect(model.getSnapshot()).toMatchObject({ busy: false, saved: true, blocked: true });
  await model.change(async () => true, write, changed);
  expect(write).toHaveBeenCalledTimes(1);
});
test("a hidden in-flight acknowledgment does not publish success into a reactivated view", async () => {
  const model = new ContextEdgeEdit();
  const release = model.activate(),
    result = deferred<{ ok: true }>(),
    changed = vi.fn();
  const task = model.change(
    async () => true,
    () => result.promise,
    changed,
  );
  await Promise.resolve();
  release();
  model.activate();
  result.resolve({ ok: true });
  await task;
  expect(changed).not.toHaveBeenCalled();
  expect(model.getSnapshot()).toMatchObject({ busy: false, saved: false, blocked: true });
  expect(model.getSnapshot().error).toContain("may have changed");
});
test("a rejected write remains blocked and retains its failure until explicit report reload", async () => {
  const model = new ContextEdgeEdit();
  model.activate();
  const write = vi.fn(async () => ({ ok: false as const, message: "Source revision conflict" }));
  await model.change(
    async () => true,
    write,
    () => {},
  );
  expect(model.getSnapshot()).toMatchObject({
    busy: false,
    blocked: true,
    error: "Source revision conflict",
  });
  await model.change(
    async () => true,
    write,
    () => {},
  );
  expect(write).toHaveBeenCalledTimes(1);
});
test("a replaced origin cannot confirm a write while the containing Context page remains active", async () => {
  const model = new ContextEdgeEdit();
  model.activate();
  const origin = {},
    confirmation = deferred<boolean>(),
    write = vi.fn(async () => ({ ok: true as const }));
  let current = origin;
  const task = model.change(
    () => confirmation.promise,
    write,
    () => {},
    () => current === origin,
  );
  current = {};
  confirmation.resolve(true);
  await task;
  expect(write).not.toHaveBeenCalled();
  expect(model.getSnapshot()).toMatchObject({ busy: false, blocked: false, saved: false });
});
test("a late origin response blocks another write on the shared page lane", async () => {
  const model = new ContextEdgeEdit();
  model.activate();
  const origin = {},
    response = deferred<{ ok: true }>(),
    changed = vi.fn();
  let current = origin;
  const write = vi.fn(() => response.promise);
  const task = model.change(
    async () => true,
    write,
    changed,
    () => current === origin,
  );
  await Promise.resolve();
  current = {};
  response.resolve({ ok: true });
  await task;
  expect(changed).not.toHaveBeenCalled();
  expect(model.getSnapshot()).toMatchObject({ busy: false, blocked: true, saved: false });
  await model.change(async () => true, write, changed);
  expect(write).toHaveBeenCalledTimes(1);
});
