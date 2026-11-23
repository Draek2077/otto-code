import { expect, it } from "vitest";
import { openBitbucketThreadAction, BitbucketThreadActionError } from "./thread-action";
function fixture(fail = false) {
  const writes: { revision: string; resolved: boolean }[] = [];
  let refreshes = 0;
  const model = openBitbucketThreadAction({
    revision: async () => "origin",
    confirm: async () => true,
    write: async (revision, resolved) => {
      writes.push({ revision, resolved });
      if (fail) throw new BitbucketThreadActionError("Refresh before repeating this change.");
    },
    refresh: async () => {
      refreshes++;
    },
  });
  return { model, writes, refreshes: () => refreshes };
}
it("resolves once with its originating revision and refreshes the canonical checkout", async () => {
  const f = fixture();
  const operation = f.model.perform(true);
  await f.model.perform(true);
  await operation;
  expect(f.writes).toEqual([{ revision: "origin", resolved: true }]);
  expect(f.refreshes()).toBe(1);
  expect(f.model.getSnapshot()).toMatchObject({ busy: false, blocked: false, error: "" });
});
it("blocks retries after a rejected write until explicit refresh", async () => {
  const f = fixture(true);
  await f.model.perform(false);
  await f.model.perform(false);
  expect(f.writes).toHaveLength(1);
  expect(f.model.getSnapshot()).toMatchObject({
    blocked: true,
    error: "Refresh before repeating this change.",
  });
  await f.model.reload();
  expect(f.model.getSnapshot()).toMatchObject({ blocked: false, error: "" });
});
it("does not execute a stale confirmation after hiding the panel", async () => {
  let finish!: (value: boolean) => void;
  let writes = 0;
  const model = openBitbucketThreadAction({
    revision: async () => "a",
    confirm: () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    write: async () => {
      writes++;
    },
    refresh: async () => {},
  });
  const operation = model.perform(true);
  await Promise.resolve();
  model.setActive(false);
  model.setActive(true);
  finish(true);
  await operation;
  expect(writes).toBe(0);
  expect(model.getSnapshot()).toMatchObject({ busy: false, blocked: false });
});
it("does not render unclassified transport errors", async () => {
  const model = openBitbucketThreadAction({
    revision: async () => {
      throw new Error("private native details");
    },
    confirm: async () => true,
    write: async () => {},
    refresh: async () => {},
  });
  await model.perform(true);
  expect(model.getSnapshot()).toMatchObject({
    blocked: false,
    error: "The host could not update this discussion. Refresh before continuing.",
  });
});
