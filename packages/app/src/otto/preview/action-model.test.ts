import { expect, test, vi } from "vitest";
import { PreviewActions } from "./action-model";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test("opening the UI is inert; duplicate confirmed actions serialize and publish success", async () => {
  const model = new PreviewActions(),
    result = deferred<string>();
  const request = vi.fn(() => result.promise),
    refresh = vi.fn(async () => {});
  expect(request).not.toHaveBeenCalled();
  model.activate();
  const first = model.run(async () => true, request, refresh);
  await Promise.resolve();
  expect(model.getSnapshot().busy).toBe(true);
  await model.run(async () => true, request, refresh);
  expect(request).toHaveBeenCalledTimes(1);
  result.resolve("Tracked");
  await first;
  expect(model.getSnapshot()).toEqual({ busy: false, error: "", notice: "Tracked" });
  expect(refresh).toHaveBeenCalledTimes(1);
});
test("declining a lifecycle confirmation never sends the write", async () => {
  const model = new PreviewActions();
  model.activate();
  const request = vi.fn(async () => "Started");
  await model.run(
    async () => false,
    request,
    async () => {},
  );
  expect(request).not.toHaveBeenCalled();
  expect(model.getSnapshot().busy).toBe(false);
});
test("a confirmation from a hidden opening cannot launch after reactivation", async () => {
  const model = new PreviewActions(),
    confirm = deferred<boolean>();
  const hide = model.activate(),
    request = vi.fn(async () => "Started");
  const pending = model.run(
    () => confirm.promise,
    request,
    async () => {},
  );
  hide();
  model.activate();
  confirm.resolve(true);
  await pending;
  expect(request).not.toHaveBeenCalled();
});
test("hidden in-flight writes keep the duplicate latch until settlement and never refresh late", async () => {
  const model = new PreviewActions(),
    result = deferred<string>();
  const hide = model.activate(),
    request = vi.fn(() => result.promise),
    refresh = vi.fn(async () => {});
  const pending = model.run(async () => true, request, refresh);
  await Promise.resolve();
  hide();
  model.activate();
  await model.run(async () => true, request, refresh);
  expect(request).toHaveBeenCalledTimes(1);
  result.resolve("Started");
  await pending;
  expect(model.getSnapshot()).toEqual({ busy: false, notice: "", error: "" });
  expect(refresh).not.toHaveBeenCalled();
});
test("a failed host operation shows recovery without leaking raw errors or retrying", async () => {
  const model = new PreviewActions();
  model.activate();
  const request = vi.fn(async (): Promise<string> => {
    throw new Error("PRIVATE_KEY=secret");
  });
  await model.run(
    async () => true,
    request,
    async () => {},
  );
  expect(request).toHaveBeenCalledTimes(1);
  expect(model.getSnapshot().error).toContain("Refresh the servers");
  expect(JSON.stringify(model.getSnapshot())).not.toContain("PRIVATE_KEY");
});
