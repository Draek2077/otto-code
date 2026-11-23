import { expect, test, vi } from "vitest";
import { HostBrowserInputs } from "./input-state.js";
function fixture() {
  const port = {
    pointer: vi.fn(async () => {}),
    releaseButton: vi.fn(async () => {}),
    key: vi.fn(async () => {}),
    touch: vi.fn(async () => {}),
    text: vi.fn(async () => {}),
    wheel: vi.fn(async () => {}),
  };
  return { port, input: new HostBrowserInputs(port) };
}
test("viewer release clears only its keys and buttons, without moving the pointer", async () => {
  const f = fixture();
  await f.input.dispatch("first", { kind: "key", phase: "down", key: "Control" });
  await f.input.dispatch("peer", { kind: "key", phase: "down", key: "Shift" });
  await f.input.dispatch("first", {
    kind: "pointer",
    phase: "down",
    button: "left",
    x: 300,
    y: 200,
  });
  await f.input.release("first");
  expect(f.port.key.mock.calls).toHaveLength(3);
  expect(f.port.key).toHaveBeenLastCalledWith({ kind: "key", phase: "up", key: "Control" });
  expect(f.port.releaseButton).toHaveBeenCalledExactlyOnceWith("left");
  expect(f.port.pointer).toHaveBeenCalledTimes(1);
  await f.input.release("peer");
  expect(f.port.key).toHaveBeenLastCalledWith({ kind: "key", phase: "up", key: "Shift" });
});
test("a stale viewer's up or release cannot release the current owner's key", async () => {
  const f = fixture();
  await f.input.dispatch("first", { kind: "key", phase: "down", key: "Control" });
  await f.input.dispatch("peer", { kind: "key", phase: "down", key: "Control" });
  await f.input.dispatch("first", { kind: "key", phase: "up", key: "Control" });
  await f.input.release("first");
  expect(f.port.key).toHaveBeenCalledTimes(2);
  await f.input.release("peer");
  expect(f.port.key).toHaveBeenCalledTimes(3);
});
test("touch contacts have one owning viewer and are canceled when that viewer disappears", async () => {
  const f = fixture(),
    points = [{ id: 0, x: 20, y: 30 }];
  await f.input.dispatch("first", { kind: "touch", phase: "start", points });
  await expect(f.input.dispatch("peer", { kind: "touch", phase: "move", points })).rejects.toThrow(
    "own",
  );
  await f.input.release("peer");
  expect(f.port.touch).toHaveBeenCalledTimes(1);
  await f.input.release("first");
  expect(f.port.touch).toHaveBeenLastCalledWith({ kind: "touch", phase: "cancel", points: [] });
  await f.input.dispatch("peer", { kind: "touch", phase: "start", points });
  expect(f.port.touch).toHaveBeenCalledTimes(3);
});
test("invalid touch identities fail before native dispatch", async () => {
  const f = fixture(),
    point = { id: 0, x: 20, y: 30 };
  await expect(
    f.input.dispatch("first", { kind: "touch", phase: "start", points: [point, point] }),
  ).rejects.toThrow("Duplicate");
  await expect(
    f.input.dispatch("first", { kind: "touch", phase: "start", points: [] }),
  ).rejects.toThrow("contact");
  expect(f.port.touch).not.toHaveBeenCalled();
});
test("CDP gesture end and cancel cannot carry contacts", async () => {
  const f = fixture(),
    points = [{ id: 0, x: 20, y: 30 }];
  await f.input.dispatch("first", { kind: "touch", phase: "start", points });
  await expect(f.input.dispatch("first", { kind: "touch", phase: "end", points })).rejects.toThrow(
    "empty",
  );
  await expect(
    f.input.dispatch("first", { kind: "touch", phase: "cancel", points }),
  ).rejects.toThrow("empty");
  expect(f.port.touch).toHaveBeenCalledTimes(1);
  await f.input.dispatch("first", { kind: "touch", phase: "end", points: [] });
  expect(f.port.touch).toHaveBeenCalledTimes(2);
});
test("cleanup attempts every owned input and preserves all release failures", async () => {
  const f = fixture();
  await f.input.dispatch("first", { kind: "key", phase: "down", key: "Control" });
  await f.input.dispatch("first", { kind: "pointer", phase: "down", button: "left", x: 0, y: 0 });
  f.port.key.mockRejectedValueOnce(new Error("key release"));
  f.port.releaseButton.mockRejectedValueOnce(new Error("button release"));
  await expect(f.input.release("first")).rejects.toMatchObject({
    errors: [
      expect.objectContaining({ message: "key release" }),
      expect.objectContaining({ message: "button release" }),
    ],
  });
  expect(f.port.releaseButton).toHaveBeenCalledTimes(1);
});
test("input backpressure is bounded and closing drops unsent actions without native execution", async () => {
  const f = fixture();
  let finish!: () => void, entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.port.key.mockImplementationOnce(async () => {
    entered();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const first = f.input.dispatch("first", { kind: "key", phase: "down", key: "Control" });
  await ready;
  const queued = Array.from({ length: 63 }, () =>
    f.input.dispatch("first", { kind: "text", text: "queued" }),
  );
  await expect(f.input.dispatch("first", { kind: "text", text: "overflow" })).rejects.toThrow(
    "full",
  );
  const cleanup = f.input.release("first");
  f.input.close();
  finish();
  await first;
  await Promise.all(queued);
  await cleanup;
  expect(f.port.text).not.toHaveBeenCalled();
  await expect(f.input.dispatch("first", { kind: "text", text: "after close" })).rejects.toThrow(
    "unavailable",
  );
});
