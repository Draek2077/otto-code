import { expect, it } from "vitest";
import { BrainResourceReader } from "./resource-reader.js";

function fixture() {
  const calls: Array<{
    signal: AbortSignal;
    resolve(value: { cpu: number }): void;
    reject(error: Error): void;
  }> = [];
  const reader = new BrainResourceReader(
    (signal) =>
      new Promise<{ cpu: number }>((resolve, reject) => {
        calls.push({ signal, resolve, reject });
      }),
  );
  return { reader, calls };
}
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

it("does no work until requested and shares one in-flight probe", async () => {
  const f = fixture();
  expect(f.calls).toHaveLength(0);
  const first = f.reader.read(new AbortController().signal);
  const second = f.reader.read(new AbortController().signal);
  await tick();
  expect(f.calls).toHaveLength(1);
  f.calls[0]!.resolve({ cpu: 0.25 });
  expect(await first).toEqual({ cpu: 0.25 });
  expect(await second).toEqual({ cpu: 0.25 });
  await f.reader.close();
});

it("canceling one reader leaves a remaining reader's probe alive", async () => {
  const f = fixture();
  const controller = new AbortController();
  const first = f.reader.read(controller.signal);
  const second = f.reader.read(new AbortController().signal);
  const canceled = expect(first).rejects.toThrow("canceled");
  await tick();
  controller.abort();
  await canceled;
  expect(f.calls[0]!.signal.aborted).toBe(false);
  f.calls[0]!.resolve({ cpu: 0.5 });
  expect(await second).toEqual({ cpu: 0.5 });
  await f.reader.close();
});

it("aborts at zero demand and refuses overlapping probes while cancellation settles", async () => {
  const f = fixture();
  const controller = new AbortController();
  const pending = f.reader.read(controller.signal);
  const canceled = expect(pending).rejects.toThrow("canceled");
  await tick();
  controller.abort();
  await canceled;
  expect(f.calls[0]!.signal.aborted).toBe(true);
  await expect(f.reader.read(new AbortController().signal)).rejects.toThrow("stopping");
  f.calls[0]!.resolve({ cpu: 1 });
  await tick();
  const fresh = f.reader.read(new AbortController().signal);
  await tick();
  expect(f.calls).toHaveLength(2);
  f.calls[1]!.resolve({ cpu: 0 });
  expect(await fresh).toEqual({ cpu: 0 });
  await f.reader.close();
});

it("a canceled request released before scheduling never starts a hardware probe", async () => {
  const f = fixture();
  const controller = new AbortController();
  const pending = f.reader.read(controller.signal);
  const canceled = expect(pending).rejects.toThrow("canceled");
  controller.abort();
  await canceled;
  await tick();
  expect(f.calls).toHaveLength(0);
  await f.reader.close();
});

it("does not expose hardware command errors and permits a later explicit read", async () => {
  const f = fixture();
  const pending = f.reader.read(new AbortController().signal);
  const failed = expect(pending).rejects.toThrow("Brain resources are unavailable");
  await tick();
  f.calls[0]!.reject(new Error("private executable and command arguments"));
  await failed;
  const fresh = f.reader.read(new AbortController().signal);
  await tick();
  f.calls[1]!.resolve({ cpu: 0.1 });
  expect(await fresh).toEqual({ cpu: 0.1 });
  await f.reader.close();
});

it("close rejects outstanding requests and late probe results cannot revive it", async () => {
  const f = fixture();
  const pending = f.reader.read(new AbortController().signal);
  const closed = expect(pending).rejects.toThrow("closed");
  await tick();
  let settled = false;
  const closing = f.reader.close().then(() => {
    settled = true;
    return true;
  });
  await closed;
  expect(settled).toBe(false);
  expect(f.calls[0]!.signal.aborted).toBe(true);
  f.calls[0]!.resolve({ cpu: 1 });
  await closing;
  await expect(f.reader.read(new AbortController().signal)).rejects.toThrow("closed");
  await f.reader.close();
});
