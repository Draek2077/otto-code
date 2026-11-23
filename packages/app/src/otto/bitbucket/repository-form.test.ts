import { expect, it } from "vitest";
import type { BitbucketRepository } from "@getpaseo/plugin/otto/bitbucket-connections";
import { openBitbucketRepositoryForm } from "./repository-form";

const repository: BitbucketRepository = {
  fullName: "work/report",
  name: "Report",
  description: null,
  private: true,
  updatedAt: null,
  cloneUrl: "https://bitbucket.org/work/report.git",
  sshUrl: "git@bitbucket.org:work/report.git",
  url: "https://bitbucket.org/work/report",
};
type Ports = Parameters<typeof openBitbucketRepositoryForm>[1];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function fixture(overrides: Partial<Ports> = {}) {
  const clones: { value: BitbucketRepository; protocol: string }[] = [];
  const writes: Parameters<Ports["create"]>[0][] = [];
  const model = openBitbucketRepositoryForm("a", {
    workspaces: async () => ({
      ok: true,
      value: {
        workspaces: [{ id: "work", label: "Work", administrator: false }],
        truncated: false,
      },
    }),
    list: async () => ({ ok: true, value: { repositories: [repository], truncated: false } }),
    create: async (input) => {
      writes.push(input);
      return { ok: true, value: repository };
    },
    clone: (value, protocol) => {
      clones.push({ value, protocol });
    },
    ...overrides,
  });
  model.edit({ workspace: "work", name: "Report", description: "A report" });
  return { model, clones, writes };
}
it("discovers real workspace choices only on explicit demand", async () => {
  let reads = 0;
  const { model } = fixture({
    workspaces: async () => {
      reads++;
      return { ok: true, value: { workspaces: [], truncated: true } };
    },
  });
  expect(reads).toBe(0);
  await model.discover();
  expect(reads).toBe(1);
  expect(model.getSnapshot()).toMatchObject({
    workspaces: [],
    workspacesTruncated: true,
    busy: false,
  });
});
it("clears old search results when workspace or query changes", async () => {
  const { model, clones } = fixture();
  await model.search();
  model.clone(repository);
  expect(clones).toEqual([{ value: repository, protocol: "ssh" }]);
  model.edit({ workspace: "other" });
  model.clone(repository);
  expect(clones).toHaveLength(1);
  expect(model.getSnapshot()).toMatchObject({ repositories: [], searched: false });
  await model.search();
  model.edit({ query: "new term" });
  expect(model.getSnapshot()).toMatchObject({ repositories: [], searched: false });
});
it("gates stale account results until explicit confirmed acknowledgment", async () => {
  const { model, clones, writes } = fixture();
  await model.search();
  model.updateRevision("b");
  model.clone(repository);
  await model.create(async () => true);
  expect(clones).toEqual([]);
  expect(writes).toEqual([]);
  await model.acknowledge("b", async () => false);
  expect(model.getSnapshot().revision).toBe("a");
  await model.acknowledge("b", async () => true);
  await model.create(async () => true);
  expect(writes).toEqual([
    {
      workspace: "work",
      name: "Report",
      description: "A report",
      private: true,
      expectedRevision: "b",
    },
  ]);
});
it("holds the write lane through confirmation and sends one accepted creation", async () => {
  const confirmation = deferred<boolean>();
  const { model, writes } = fixture();
  const first = model.create(() => confirmation.promise);
  await model.create(async () => true);
  expect(writes).toEqual([]);
  confirmation.resolve(true);
  await first;
  expect(writes).toHaveLength(1);
  expect(model.getSnapshot()).toMatchObject({
    busy: false,
    creating: false,
    repositories: [repository],
  });
});
it("keeps an unknown create outcome blocked and preserves its draft without retry", async () => {
  let writes = 0;
  const { model } = fixture({
    create: async () => {
      writes++;
      throw new Error("private transport details");
    },
  });
  await model.create(async () => true);
  await model.create(async () => true);
  expect(writes).toBe(1);
  expect(model.getSnapshot()).toMatchObject({
    blocked: true,
    name: "Report",
    description: "A report",
  });
  expect(model.getSnapshot().error).not.toContain("private transport");
});
it("ignores a stale read failure after hide and reactivation", async () => {
  const request = deferred<Awaited<ReturnType<Ports["list"]>>>();
  const { model } = fixture({ list: () => request.promise });
  const reading = model.search();
  model.setActive(false);
  model.setActive(true);
  request.reject(new Error("previous page"));
  await reading;
  expect(model.getSnapshot()).toMatchObject({ repositories: [], busy: false, error: "" });
});
it("does not start a remote write after its confirmation was hidden", async () => {
  const confirmation = deferred<boolean>();
  const { model, writes } = fixture();
  const creating = model.create(() => confirmation.promise);
  model.setActive(false);
  model.setActive(true);
  confirmation.resolve(true);
  await creating;
  expect(writes).toEqual([]);
  expect(model.getSnapshot()).toMatchObject({ busy: false, blocked: false });
});
it("blocks a hidden accepted remote write without silently adopting its result", async () => {
  const request = deferred<Awaited<ReturnType<Ports["create"]>>>();
  const { model } = fixture({ create: () => request.promise });
  const creating = model.create(async () => true);
  await Promise.resolve();
  model.setActive(false);
  model.setActive(true);
  request.resolve({ ok: true, value: repository });
  await creating;
  expect(model.getSnapshot()).toMatchObject({
    busy: false,
    blocked: true,
    repositories: [],
    name: "Report",
  });
});
