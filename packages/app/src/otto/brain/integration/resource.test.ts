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
  const first = resource.read();
  resource.invalidate();
  const second = resource.read();
  old.resolve("old owner");
  await first;
  expect(resource.getSnapshot()).toMatchObject({ data: undefined, isFetching: true });
  next.resolve("current owner");
  await second;
  expect(resource.getSnapshot()).toMatchObject({ data: "current owner", isFetching: false });
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
