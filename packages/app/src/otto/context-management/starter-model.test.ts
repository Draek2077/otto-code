import { expect, test, vi } from "vitest";
import { ContextStarterModel } from "./starter-model";
import { ContextEdgeEdit } from "./edge-edit";
const origin = {
  fileName: "AGENTS.md" as const,
  projectLabel: "project",
  revision: "reviewed",
  repositoryContext: "{}",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const read = vi.fn(async () => origin),
    propose = vi.fn(async () => ({ text: "generated draft" })),
    create = vi.fn(async () => ({ ok: true as const }));
  const model = new ContextStarterModel({ read, propose, create });
  const hide = model.activate();
  const writes = new ContextEdgeEdit();
  writes.activate();
  return { read, propose, create, model, hide, writes };
}
const yes = async () => true,
  no = async () => false;
test("loading and proposal generation never create a file; save uses reviewed revision", async () => {
  const { model, create, writes } = fixture();
  await model.load("AGENTS.md", yes);
  await model.generate(yes);
  expect(create).not.toHaveBeenCalled();
  const changed = vi.fn();
  await model.save(writes, yes, changed);
  expect(create).toHaveBeenCalledExactlyOnceWith({
    fileName: "AGENTS.md",
    expectedRevision: "reviewed",
    text: "generated draft",
  });
  expect(changed).toHaveBeenCalledOnce();
});
test("declined reload and regeneration preserve the edited draft", async () => {
  const { model, read, propose } = fixture();
  await model.load("AGENTS.md", yes);
  model.edit("my draft");
  await model.load("CLAUDE.md", no);
  await model.generate(no);
  expect(model.getSnapshot().text).toBe("my draft");
  expect(read).toHaveBeenCalledTimes(1);
  expect(propose).not.toHaveBeenCalled();
});
test("generation failure preserves a draft and exposes safe recovery copy", async () => {
  const { model, propose } = fixture();
  await model.load("AGENTS.md", yes);
  model.edit("my draft");
  propose.mockRejectedValueOnce(Error("private provider diagnostic"));
  await model.generate(yes);
  expect(model.getSnapshot().text).toBe("my draft");
  expect(model.getSnapshot().error).toContain("Check the provider");
  expect(model.getSnapshot().error).not.toContain("private");
});
test("a hidden proposal cannot replace a draft in a new activation", async () => {
  const { model, propose, hide } = fixture();
  await model.load("AGENTS.md", yes);
  model.edit("kept");
  const pending = deferred<{ text: string }>();
  propose.mockReturnValueOnce(pending.promise);
  const work = model.generate(yes);
  await Promise.resolve();
  hide();
  model.activate();
  pending.resolve({ text: "late" });
  await work;
  expect(model.getSnapshot().text).toBe("kept");
});
test("hidden confirmation cannot dispatch a create", async () => {
  const { model, create, hide, writes } = fixture();
  await model.load("AGENTS.md", yes);
  model.edit("draft");
  const confirm = deferred<boolean>(),
    work = model.save(writes, () => confirm.promise, vi.fn());
  hide();
  confirm.resolve(true);
  await work;
  expect(create).not.toHaveBeenCalled();
  expect(model.getSnapshot().text).toBe("draft");
});
test("duplicate pending actions are not admitted and a hidden create cannot claim success", async () => {
  const { model, create, hide, writes } = fixture();
  await model.load("AGENTS.md", yes);
  model.edit("draft");
  const pending = deferred<{ ok: true }>();
  create.mockReturnValueOnce(pending.promise);
  const changed = vi.fn();
  const work = model.save(writes, yes, changed);
  await Promise.resolve();
  await model.save(writes, yes, changed);
  expect(create).toHaveBeenCalledTimes(1);
  hide();
  model.activate();
  pending.resolve({ ok: true });
  await work;
  expect(model.getSnapshot().created).toBe(false);
  expect(changed).not.toHaveBeenCalled();
  expect(writes.getSnapshot().blocked).toBe(true);
});
test("a read failure retains the originating draft and revision", async () => {
  const { model, read } = fixture();
  await model.load("AGENTS.md", yes);
  model.edit("kept");
  read.mockRejectedValueOnce(Error("offline"));
  await model.load("CLAUDE.md", yes);
  expect(model.getSnapshot().text).toBe("kept");
  expect(model.getSnapshot().origin?.revision).toBe("reviewed");
});
test("declining create leaves a review editable and the mutation lane usable", async () => {
  const { model, writes, create } = fixture();
  await model.load("AGENTS.md", yes);
  model.edit("draft");
  await model.save(writes, no, vi.fn());
  expect(create).not.toHaveBeenCalled();
  expect(writes.getSnapshot().blocked).toBe(false);
  model.edit("revised");
  expect(model.getSnapshot().text).toBe("revised");
});
