import { expect, test, vi } from "vitest";
import type { GitFetchSettings } from "@getpaseo/plugin/otto/workspace-git";
import { GitFetchForm } from "./form";
import { GitFetchError } from "./port";

const initial: GitFetchSettings = {
  revision: "original",
  preferences: { enabled: false, intervalSeconds: 180 },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function prepare() {
  const read = vi.fn(async () => initial);
  const save = vi.fn(async () => ({ ...initial, revision: "accepted" }));
  const model = new GitFetchForm({ read, save });
  const close = model.activate();
  await Promise.resolve();
  return { model, read, save, close };
}
test("explicit Save sends only changed fields at the originating revision, never autosaves", async () => {
  const f = await prepare();
  f.model.edit({ intervalSeconds: 900 });
  expect(f.save).not.toHaveBeenCalled();
  await f.model.save();
  expect(f.save).toHaveBeenCalledExactlyOnceWith("original", { intervalSeconds: 900 });
  expect(f.model.getSnapshot()).toMatchObject({
    phase: "ready",
    dirty: false,
    notice: "Git fetch settings saved.",
    saved: { revision: "accepted" },
  });
  f.close();
});
test("a failed or conflicting save retains the draft and prohibits retry until confirmed reload", async () => {
  const f = await prepare();
  f.model.edit({ enabled: true });
  f.save.mockRejectedValueOnce(new GitFetchError("Settings changed; reload."));
  await f.model.save();
  await f.model.save();
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.model.getSnapshot()).toMatchObject({
    phase: "blocked",
    dirty: true,
    draft: { enabled: true },
    notice: "Settings changed; reload.",
  });
  await f.model.reload(async () => false);
  expect(f.read).toHaveBeenCalledTimes(1);
  await f.model.reload(async () => true);
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.model.getSnapshot()).toMatchObject({
    phase: "ready",
    dirty: false,
    draft: initial.preferences,
  });
  f.close();
});
test("one in-flight save locks edits and duplicates; a hidden acknowledgement never adopts a new revision", async () => {
  const f = await prepare(),
    pending = deferred<GitFetchSettings>();
  f.save.mockReturnValueOnce(pending.promise);
  f.model.edit({ enabled: true });
  const saving = f.model.save();
  f.model.edit({ intervalSeconds: 600 });
  await f.model.save();
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.model.getSnapshot().draft?.intervalSeconds).toBe(180);
  f.close();
  const close = f.model.activate();
  pending.resolve({ ...initial, revision: "late" });
  await saving;
  expect(f.model.getSnapshot()).toMatchObject({
    phase: "blocked",
    saved: { revision: "original" },
    dirty: true,
  });
  await f.model.save();
  expect(f.save).toHaveBeenCalledTimes(1);
  await f.model.reload(async () => true);
  expect(f.model.getSnapshot().phase).toBe("ready");
  close();
});
test("late read and reload confirmation cannot overwrite a newly activated draft", async () => {
  const pending = deferred<GitFetchSettings>();
  const read = vi.fn(() => pending.promise),
    save = vi.fn();
  const model = new GitFetchForm({ read, save });
  const close = model.activate();
  close();
  const closeNext = model.activate();
  pending.resolve(initial);
  await pending.promise;
  expect(model.getSnapshot().saved).toBeNull();
  await model.reload(async () => true);
  model.edit({ enabled: true });
  const answer = deferred<boolean>();
  const reloading = model.reload(() => answer.promise);
  closeNext();
  const finalClose = model.activate();
  answer.resolve(true);
  await reloading;
  expect(model.getSnapshot().draft?.enabled).toBe(true);
  finalClose();
});
