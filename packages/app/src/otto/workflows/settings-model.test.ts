import { test, expect, vi } from "vitest";
import { WorkflowStorageForm } from "./settings-model";
import { deferred } from "./test-fixtures";
test("storage saves originating revision without moving documents or adopting peer state", async () => {
  const model = new WorkflowStorageForm("origin", "inherit"),
    release = model.activate(),
    write = vi.fn(async () => ({ revision: "ack", value: "host" }));
  model.select("host");
  await model.save(write);
  expect(write).toHaveBeenCalledWith("origin", "host");
  expect(model.getSnapshot()).toMatchObject({ revision: "ack", value: "host", changed: false });
  release();
});
test("storage conflicts retain the local choice until an explicit confirmed reload", async () => {
  const model = new WorkflowStorageForm("origin", "host"),
    release = model.activate(),
    write = vi.fn(async () => {
      throw new Error("Peer changed");
    });
  model.select("repository");
  await model.save(write);
  await model.save(write);
  expect(write).toHaveBeenCalledOnce();
  expect(model.getSnapshot()).toMatchObject({
    revision: "origin",
    value: "repository",
    blocked: true,
  });
  await model.reload(
    async () => ({ revision: "peer", value: "host" }),
    async () => false,
  );
  expect(model.getSnapshot().value).toBe("repository");
  await model.reload(
    async () => ({ revision: "peer", value: "host" }),
    async () => true,
  );
  expect(model.getSnapshot()).toMatchObject({ revision: "peer", value: "host", blocked: false });
  release();
});
test("hidden storage acknowledgment cannot silently rebase a reactivated draft", async () => {
  const model = new WorkflowStorageForm("origin", "host"),
    release = model.activate(),
    pending = deferred<{ revision: string; value: string }>();
  model.select("repository");
  const saving = model.save(() => pending.promise);
  release();
  const active = model.activate();
  pending.resolve({ revision: "late", value: "repository" });
  await saving;
  expect(model.getSnapshot()).toMatchObject({
    revision: "origin",
    value: "repository",
    blocked: true,
  });
  active();
});
