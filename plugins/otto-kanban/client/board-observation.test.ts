import { expect, it, vi } from "vitest";
import { observeBoard } from "./board-observation.js";

function fixture() {
  const replies: Array<(value: { ok: true; value: { cursor: string } }) => void> = [];
  const wait = vi.fn(
    () => new Promise<{ ok: true; value: { cursor: string } }>((resolve) => replies.push(resolve)),
  );
  const release = vi.fn(async () => undefined);
  const changed = vi.fn();
  const failed = vi.fn();
  const stop = observeBoard({
    binding: { hostId: "host", projectId: "project" },
    leaseId: "lease",
    wait,
    release,
    changed,
    failed,
  });
  return { replies, wait, release, changed, failed, stop };
}
it("uses one cursor stream and invalidates only on initial or changed reads", async () => {
  const f = fixture();
  f.replies.shift()!({ ok: true, value: { cursor: "one" } });
  await Promise.resolve();
  expect(f.changed).toHaveBeenCalledTimes(1);
  expect(f.wait).toHaveBeenLastCalledWith({
    binding: { hostId: "host", projectId: "project" },
    leaseId: "lease",
    cursor: "one",
  });
  f.replies.shift()!({ ok: true, value: { cursor: "one" } });
  await Promise.resolve();
  expect(f.changed).toHaveBeenCalledTimes(1);
  f.replies.shift()!({ ok: true, value: { cursor: "two" } });
  await Promise.resolve();
  expect(f.changed).toHaveBeenCalledTimes(2);
  f.stop();
  f.replies.shift()!({ ok: true, value: { cursor: "late" } });
  await Promise.resolve();
  expect(f.changed).toHaveBeenCalledTimes(2);
  expect(f.failed).not.toHaveBeenCalled();
});
it("releases again when a hidden initial retain settles after its first release", async () => {
  const f = fixture();
  f.stop();
  expect(f.release).toHaveBeenCalledTimes(1);
  f.replies.shift()!({ ok: true, value: { cursor: "late" } });
  await Promise.resolve();
  expect(f.release).toHaveBeenCalledTimes(2);
  expect(f.changed).not.toHaveBeenCalled();
  expect(f.wait).toHaveBeenCalledTimes(1);
});
it("pauses on transport failure without retrying or publishing diagnostics", async () => {
  const failed = vi.fn();
  const release = vi.fn(async () => undefined);
  const wait = vi.fn(async () => {
    throw new Error("private transport details");
  });
  const stop = observeBoard({
    binding: { hostId: "host", projectId: "project" },
    leaseId: "lease",
    wait,
    release,
    changed: vi.fn(),
    failed,
  });
  await Promise.resolve();
  expect(failed).toHaveBeenCalledWith();
  expect(wait).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledTimes(1);
  stop();
});
