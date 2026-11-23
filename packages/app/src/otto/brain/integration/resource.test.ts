import { expect, test } from "vitest";
import { BrainResource } from "./resource";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
test("passive reads stay inert and concurrent consumers share the same resource request", async () => {
  let calls = 0;
  const reply = deferred<string>();
  const resource = new BrainResource(
    () => {
      calls++;
      return reply.promise;
    },
    () => {},
  );
  const initial = resource.getSnapshot();
  expect(resource.getSnapshot()).toBe(initial);
  expect(calls).toBe(0);
  const first = resource.retain();
  const second = resource.retain();
  const read = resource.read();
  expect(calls).toBe(1);
  reply.resolve("owner value");
  expect(await read).toBe("owner value");
  expect(resource.getSnapshot()).toMatchObject({
    data: "owner value",
    isFetching: false,
    isError: false,
  });
  first();
  second();
  resource.refreshDemanded();
  expect(calls).toBe(1);
});
test("an owner invalidation cannot let an older request replace a new snapshot or its loading state", async () => {
  const old = deferred<string>();
  const next = deferred<string>();
  let reads = 0;
  const resource = new BrainResource(
    () => (++reads === 1 ? old.promise : next.promise),
    () => {},
  );
  const release = resource.retain();
  const first = resource.read();
  resource.refreshDemanded();
  resource.invalidate();
  const second = resource.read();
  old.resolve("old owner");
  await first;
  expect(resource.getSnapshot()).toMatchObject({ data: undefined, isFetching: true });
  next.resolve("current owner");
  await second;
  expect(resource.getSnapshot()).toMatchObject({ data: "current owner", isFetching: false });
  expect(reads).toBe(2);
  release();
});
test("a failed refresh retains the last data and exposes the error to the requesting view", async () => {
  const reply = deferred<string>();
  const resource = new BrainResource(
    () => reply.promise,
    () => {},
  );
  resource.accept("retained");
  const read = resource.read();
  const failure = new Error("Host disconnected");
  reply.reject(failure);
  await expect(read).rejects.toBe(failure);
  expect(resource.getSnapshot()).toMatchObject({
    data: "retained",
    error: failure,
    isError: true,
    isLoading: false,
    isFetching: false,
  });
});

test("a terminal-job invalidation during an older read is not lost when that read settles", async () => {
  const old = deferred<string>();
  let reads = 0;
  const resource = new BrainResource(
    () => (++reads === 1 ? old.promise : Promise.resolve("canceled")),
    () => {},
  );
  const release = resource.retain();
  const first = resource.read();
  resource.refreshDemanded();
  resource.refreshDemanded();
  old.resolve("running");
  await first;
  expect(reads).toBe(2);
  await resource.read();
  expect(resource.getSnapshot()).toMatchObject({
    data: "canceled",
    isFetching: false,
    isError: false,
  });
  release();
});

test("an explicit post-mutation refresh waits for a query begun after the mutation, sharing concurrent refresh intent", async () => {
  const old = deferred<string>();
  let reads = 0;
  const resource = new BrainResource(
    () => (++reads === 1 ? old.promise : Promise.resolve("canceled")),
    () => {},
  );
  const before = resource.read();
  const first = resource.refresh();
  const second = resource.refetch();
  old.resolve("running");
  await before;
  expect(await first).toBe("canceled");
  await second;
  expect(reads).toBe(2);
  expect(resource.getSnapshot().data).toBe("canceled");
});
test("hiding the last consumer cancels queued invalidation work without starting another request", async () => {
  const old = deferred<string>();
  let reads = 0;
  const resource = new BrainResource(
    () => {
      reads++;
      return old.promise;
    },
    () => {},
  );
  const release = resource.retain();
  const before = resource.read();
  resource.refreshDemanded();
  release();
  old.resolve("running");
  await before;
  expect(reads).toBe(1);
});
test("an older query cannot overwrite a newer accepted job projection or its error state", async () => {
  const old = deferred<string>();
  const resource = new BrainResource(
    () => old.promise,
    () => {},
  );
  const before = resource.read();
  resource.accept("accepted owner value");
  old.resolve("old read");
  await before;
  expect(resource.getSnapshot()).toMatchObject({
    data: "accepted owner value",
    isFetching: false,
    isError: false,
  });
  const failure = deferred<string>();
  const other = new BrainResource(
    () => failure.promise,
    () => {},
  );
  const reading = other.read();
  other.accept("newer accepted value");
  failure.reject(new Error("Earlier read failed"));
  await expect(reading).rejects.toThrow("Earlier read failed");
  expect(other.getSnapshot()).toMatchObject({
    data: "newer accepted value",
    error: null,
    isError: false,
  });
});
test("explicit refresh does not carry pending work into a replacement owner", async () => {
  const old = deferred<string>();
  let reads = 0;
  const resource = new BrainResource(
    () => {
      reads++;
      return old.promise;
    },
    () => {},
  );
  const before = resource.read();
  const refresh = resource.refresh();
  resource.invalidate();
  old.resolve("old owner");
  await before;
  await expect(refresh).rejects.toThrow("Brain owner changed");
  expect(resource.getSnapshot().data).toBeUndefined();
  expect(reads).toBe(1);
});

test("a queued revision refresh survives a failed older read without becoming a retry loop", async () => {
  const old = deferred<string>();
  const next = deferred<string>();
  let reads = 0;
  const resource = new BrainResource(
    () => (++reads === 1 ? old.promise : next.promise),
    () => {},
  );
  const release = resource.retain();
  const before = resource.read();
  resource.refreshDemanded();
  resource.refreshDemanded();
  old.reject(new Error("Earlier query failed"));
  await expect(before).rejects.toThrow("Earlier query failed");
  expect(reads).toBe(2);
  const current = resource.read();
  next.resolve("canceled");
  await current;
  expect(resource.getSnapshot()).toMatchObject({
    data: "canceled",
    isFetching: false,
    isError: false,
  });
  expect(reads).toBe(2);
  release();
});
