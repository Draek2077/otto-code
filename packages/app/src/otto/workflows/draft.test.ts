import { test, expect, vi } from "vitest";
import { WorkflowOperationError } from "@getpaseo/plugin/otto/workflows";
import { WorkflowDraft, type WorkflowDraftPorts } from "./draft";
import { scope, entry, authored, deferred } from "./test-fixtures";
function fixture() {
  const original = entry(),
    model = new WorkflowDraft(scope, authored(), original),
    release = model.activate();
  const ports: WorkflowDraftPorts = {
    read: async () => entry(),
    save: vi.fn(async (input) => ({
      ref: original.ref,
      revision: "saved",
      document: input.document,
    })),
  };
  return { model, release, ports };
}
test("Workflow drafts save one originating revision and preserve unknown authored fields", async () => {
  const f = fixture();
  f.model.patch(["value", "title"], "Edited");
  await f.model.save(f.ports);
  expect(f.ports.save).toHaveBeenCalledOnce();
  expect(f.ports.save).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedRevision: "origin",
      document: expect.objectContaining({
        value: expect.objectContaining({ title: "Edited", unknown: { retain: 1 } }),
      }),
    }),
  );
  expect(f.model.getSnapshot()).toMatchObject({
    dirty: false,
    blocked: false,
    origin: { revision: "saved" },
  });
  f.release();
});
test("a duplicate submit is not another write; newer edits survive own acknowledgment", async () => {
  const f = fixture(),
    pending = deferred<WorkflowEntryForTest>();
  f.ports.save = vi.fn(() => pending.promise);
  f.model.patch(["value", "title"], "First");
  const saving = f.model.save(f.ports);
  f.model.patch(["value", "title"], "Newer");
  expect(await f.model.save(f.ports)).toBeNull();
  pending.resolve({ ...entry(), revision: "acknowledged" });
  await saving;
  expect(f.ports.save).toHaveBeenCalledOnce();
  expect(f.model.getSnapshot()).toMatchObject({
    document: { value: { title: "Newer" } },
    dirty: true,
    origin: { revision: "acknowledged" },
  });
  f.release();
});
type WorkflowEntryForTest = ReturnType<typeof entry>;
test("conflict retains dirty data and cannot silently adopt a peer revision", async () => {
  const f = fixture();
  f.ports.save = vi.fn(async () => {
    throw new WorkflowOperationError("conflict", "Peer changed");
  });
  f.model.patch(["value", "title"], "Mine");
  await f.model.save(f.ports);
  await f.model.save(f.ports);
  expect(f.ports.save).toHaveBeenCalledOnce();
  expect(f.model.getSnapshot()).toMatchObject({
    blocked: true,
    dirty: true,
    document: { value: { title: "Mine" } },
    origin: { revision: "origin" },
  });
  await f.model.reload(f.ports, async () => false);
  expect(f.model.getSnapshot().blocked).toBe(true);
  await f.model.reload(f.ports, async () => true);
  expect(f.model.getSnapshot()).toMatchObject({
    blocked: false,
    dirty: false,
    document: { value: { title: "Original" } },
  });
  f.release();
});
test("known pre-write validation can be corrected without discarding the draft", async () => {
  const f = fixture();
  f.model.patch(["value", "title"], "");
  await f.model.save(f.ports);
  expect(f.ports.save).not.toHaveBeenCalled();
  expect(f.model.getSnapshot().blocked).toBe(false);
  f.model.patch(["value", "title"], "Corrected");
  await f.model.save(f.ports);
  expect(f.ports.save).toHaveBeenCalledOnce();
  f.release();
});
test("hidden in-flight save remains unknown, with no late revision adoption or duplicate retry", async () => {
  const f = fixture(),
    pending = deferred<WorkflowEntryForTest>();
  f.ports.save = vi.fn(() => pending.promise);
  const saving = f.model.save(f.ports);
  f.release();
  const release = f.model.activate();
  pending.resolve({ ...entry(), revision: "late" });
  expect(await saving).toBeNull();
  await f.model.save(f.ports);
  expect(f.ports.save).toHaveBeenCalledOnce();
  expect(f.model.getSnapshot()).toMatchObject({ blocked: true, origin: { revision: "origin" } });
  release();
});
test("an old reload confirmation cannot replace a reactivated draft", async () => {
  const f = fixture(),
    confirm = deferred<boolean>();
  const pending = f.model.reload(f.ports, () => confirm.promise);
  f.release();
  const release = f.model.activate();
  f.model.patch(["value", "title"], "Still mine");
  confirm.resolve(true);
  await pending;
  expect(f.model.getSnapshot().document.value.title).toBe("Still mine");
  release();
});
test("invalid JSON in any advanced field fences save until that field is corrected", async () => {
  const f = fixture();
  f.model.error("Invalid loop", "loop");
  f.model.error("Invalid retry", "retry");
  f.model.error("", "loop");
  await f.model.save(f.ports);
  expect(f.ports.save).not.toHaveBeenCalled();
  expect(f.model.getSnapshot().error).toBe("Invalid retry");
  f.model.error("", "retry");
  await f.model.save(f.ports);
  expect(f.ports.save).toHaveBeenCalledOnce();
  f.release();
});
