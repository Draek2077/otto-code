import { expect, test, vi } from "vitest";
import type { ContextSourceFile } from "@getpaseo/plugin/otto/context-management";
import {
  ContextSourceModel,
  ContextSourceDrafts,
  contextLineSelection,
  type ContextSourcePort,
} from "./source-model";
import { ContextEdgeEdit } from "./edge-edit";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const source: ContextSourceFile = {
  nodeId: "file",
  label: "AGENTS.md",
  text: "ORIGINAL",
  revision: "origin",
  scope: "project",
  writable: true,
  readOnlyReason: null,
};
async function fixture(file = source) {
  const read = vi.fn(async () => file);
  const save = vi.fn<ContextSourcePort["save"]>(async () => ({ ok: true, revision: "accepted" }));
  const model = new ContextSourceModel({ read, save });
  const release = model.activate();
  await Promise.resolve();
  const lane = new ContextEdgeEdit();
  lane.activate();
  return { model, read, save, release, lane };
}
test("current-source reads never write, and retained drafts do not follow activation or option churn", async () => {
  const f = await fixture();
  expect(f.model.getSnapshot()).toMatchObject({ file: source, text: "ORIGINAL", dirty: false });
  expect(f.save).not.toHaveBeenCalled();
  f.model.setText("LOCAL");
  f.release();
  f.read.mockResolvedValue({ ...source, text: "PEER", revision: "peer" });
  f.model.activate();
  await Promise.resolve();
  expect(f.read).toHaveBeenCalledTimes(1);
  expect(f.model.getSnapshot()).toMatchObject({
    text: "LOCAL",
    dirty: true,
    file: { revision: "origin" },
  });
  const drafts = new ContextSourceDrafts();
  expect(drafts.open("one", { read: f.read, save: f.save })).toBe(
    drafts.open("one", { read: f.read, save: f.save }),
  );
  expect(drafts.open("two", { read: f.read, save: f.save })).not.toBe(
    drafts.open("one", { read: f.read, save: f.save }),
  );
});
test("declined saves keep local intent; accepted saves use only the originating revision and acknowledge exact text", async () => {
  const f = await fixture();
  f.model.setText("DRAFT");
  await f.model.save(
    f.lane,
    async () => false,
    () => {},
  );
  expect(f.save).not.toHaveBeenCalled();
  const changed = vi.fn();
  await f.model.save(f.lane, async () => true, changed);
  expect(f.save).toHaveBeenCalledExactlyOnceWith({
    text: "DRAFT",
    expectedRevision: "origin",
    userApprovedGlobal: false,
  });
  expect(f.model.getSnapshot()).toMatchObject({
    text: "DRAFT",
    dirty: false,
    file: { text: "DRAFT", revision: "accepted" },
  });
  expect(changed).toHaveBeenCalledTimes(1);
  expect(f.lane.getSnapshot()).toMatchObject({ blocked: true, saved: true });
});
test("one shared lane serializes source confirmation/write and retains a conflicting draft without reload/rebase", async () => {
  const f = await fixture(),
    confirmation = deferred<boolean>();
  f.model.setText("DRAFT");
  f.save.mockResolvedValue({ ok: false, message: "Peer revision changed" });
  const task = f.model.save(
    f.lane,
    () => confirmation.promise,
    () => {},
  );
  await f.model.save(
    f.lane,
    async () => true,
    () => {},
  );
  confirmation.resolve(true);
  await task;
  await f.model.save(
    f.lane,
    async () => true,
    () => {},
  );
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.read).toHaveBeenCalledTimes(1);
  expect(f.model.getSnapshot()).toMatchObject({
    text: "DRAFT",
    dirty: true,
    file: { revision: "origin" },
  });
  expect(f.lane.getSnapshot()).toMatchObject({ blocked: true, error: "Peer revision changed" });
});
test("explicit reload requires discard approval and retains the draft when the host read fails", async () => {
  const f = await fixture();
  f.model.setText("DRAFT");
  expect(await f.model.reload(async () => false)).toBe(false);
  f.read.mockRejectedValueOnce(Error("Owning host unavailable"));
  expect(await f.model.reload(async () => true)).toBe(false);
  expect(f.model.getSnapshot()).toMatchObject({
    text: "DRAFT",
    dirty: true,
    file: { revision: "origin" },
    error: "Owning host unavailable",
  });
  f.read.mockResolvedValue({ ...source, revision: "peer", text: "PEER" });
  expect(await f.model.reload(async () => true)).toBe(true);
  expect(f.model.getSnapshot()).toMatchObject({
    text: "PEER",
    dirty: false,
    file: { revision: "peer" },
    error: "",
  });
});
test("host-wide approval is explicit and hidden in-flight writes cannot acknowledge or replace retained drafts", async () => {
  const f = await fixture({ ...source, scope: "host" }),
    reply = deferred<Awaited<ReturnType<ContextSourcePort["save"]>>>();
  f.model.setText("GLOBAL DRAFT");
  f.save.mockReturnValue(reply.promise);
  const confirm = vi.fn(async () => true),
    changed = vi.fn();
  const task = f.model.save(f.lane, confirm, changed);
  await Promise.resolve();
  expect(confirm).toHaveBeenCalledWith(true);
  expect(f.save).toHaveBeenCalledWith({
    expectedRevision: "origin",
    text: "GLOBAL DRAFT",
    userApprovedGlobal: true,
  });
  f.release();
  f.model.activate();
  reply.resolve({ ok: true, revision: "hidden-accepted" });
  await task;
  expect(changed).not.toHaveBeenCalled();
  expect(f.model.getSnapshot()).toMatchObject({
    text: "GLOBAL DRAFT",
    dirty: true,
    file: { revision: "origin" },
  });
  expect(f.lane.getSnapshot()).toMatchObject({ blocked: true, saved: false });
});
test("hidden save and reload confirmations cannot dispatch after reactivation", async () => {
  const f = await fixture(),
    yes = deferred<boolean>();
  f.model.setText("DRAFT");
  const task = f.model.save(
    f.lane,
    () => yes.promise,
    () => {},
  );
  f.release();
  const hide = f.model.activate();
  yes.resolve(true);
  await task;
  expect(f.save).not.toHaveBeenCalled();
  const discard = deferred<boolean>(),
    reload = f.model.reload(() => discard.promise);
  hide();
  f.model.activate();
  discard.resolve(true);
  expect(await reload).toBe(false);
  expect(f.read).toHaveBeenCalledTimes(1);
  expect(f.model.getSnapshot().text).toBe("DRAFT");
});
test("stale initial and explicit-reload replies never replace a later activation's file/draft", async () => {
  const old = deferred<ContextSourceFile>(),
    latest = deferred<ContextSourceFile>();
  const read = vi
    .fn<ContextSourcePort["read"]>()
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(latest.promise);
  const model = new ContextSourceModel({
    read,
    save: async () => ({ ok: true, revision: "accepted" }),
  });
  const hide = model.activate();
  hide();
  const hideAgain = model.activate();
  latest.resolve({ ...source, text: "LATEST", revision: "latest" });
  await Promise.resolve();
  old.resolve(source);
  await Promise.resolve();
  expect(model.getSnapshot()).toMatchObject({ text: "LATEST", file: { revision: "latest" } });
  model.setText("LOCAL");
  const peer = deferred<ContextSourceFile>();
  read.mockReturnValueOnce(peer.promise);
  const reload = model.reload(async () => true);
  await Promise.resolve();
  hideAgain();
  model.activate();
  peer.resolve({ ...source, text: "OLD RELOAD" });
  expect(await reload).toBe(false);
  expect(model.getSnapshot()).toMatchObject({ text: "LOCAL", dirty: true });
});
test("clean reactivation refreshes the current file, while read-only files cannot become edits", async () => {
  const f = await fixture({ ...source, writable: false, readOnlyReason: "Linked file" });
  f.model.setText("NO EDIT");
  await f.model.save(
    f.lane,
    async () => true,
    () => {},
  );
  expect(f.save).not.toHaveBeenCalled();
  expect(f.model.getSnapshot().text).toBe("ORIGINAL");
  f.release();
  f.read.mockResolvedValue({ ...source, revision: "new", text: "FRESH" });
  f.model.activate();
  await Promise.resolve();
  expect(f.model.getSnapshot()).toMatchObject({ text: "FRESH", file: { revision: "new" } });
});
test("an obsolete clean reload cannot clear a newer activation's read lock and admit an overwritten draft", async () => {
  const f = await fixture();
  const old = deferred<ContextSourceFile>(),
    latest = deferred<ContextSourceFile>();
  f.read.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  const reload = f.model.reload(async () => true);
  f.release();
  f.model.activate();
  old.resolve({ ...source, text: "OBSOLETE" });
  expect(await reload).toBe(false);
  expect(f.model.getSnapshot().reading).toBe(true);
  f.model.setText("MUST_NOT_BE_ADMITTED");
  expect(f.model.getSnapshot().dirty).toBe(false);
  latest.resolve({ ...source, text: "FRESH", revision: "latest" });
  await Promise.resolve();
  expect(f.model.getSnapshot()).toMatchObject({ text: "FRESH", reading: false, dirty: false });
});

test("line jumps use UTF-16 offsets and preserve CRLF, Unicode and bounded out-of-range selections", () => {
  const text = "😀 first\r\nsecond\r\nthird";
  const selected = contextLineSelection(text, 2, 3);
  expect(text.slice(selected.start, selected.end)).toBe("second\r\nthird");
  expect(contextLineSelection(text, 100, 101)).toEqual({ start: 18, end: 23 });
  expect(contextLineSelection("", 1, 1)).toEqual({ start: 0, end: 0 });
});
