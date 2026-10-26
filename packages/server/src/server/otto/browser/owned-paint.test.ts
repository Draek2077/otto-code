import { expect, test, vi } from "vitest";
import {
  SessionDelivery,
  type OwnedBinaryOperation,
} from "../../session/owned-subscriptions/index.js";
function stopNothing() {}
async function retain(delivery: SessionDelivery, source: object, stop = () => {}) {
  let operation!: OwnedBinaryOperation;
  await delivery.request(source, { type: "ping", requestId: "paint-fixture" }, async () => {
    operation = delivery.binaryOperation(stop);
  });
  return operation;
}
test("paint delivery keeps the originating source after the RPC ends, without broadcast or JSON authority", async () => {
  const sent: object[] = [],
    json = vi.fn();
  const delivery = new SessionDelivery(json, (source, frame) => {
    expect(delivery.permitsBinary(source, frame)).toBe(true);
    sent.push(source);
  });
  const owner = {},
    peer = {};
  delivery.attach(owner, true);
  delivery.attach(peer, true);
  const operation = await retain(delivery, owner);
  const frame = new Uint8Array([0x20, 1]);
  operation.emitBinary(frame);
  expect(sent).toEqual([owner]);
  expect(delivery.permitsBinary(peer, frame)).toBe(false);
  operation.emit({ type: "status", payload: { status: "error", message: "not a frame" } });
  expect(json).not.toHaveBeenCalled();
  await delivery.close();
});
test("release is idempotent and invalidates retained frame proofs and late producers", async () => {
  const sent = vi.fn(),
    stop = vi.fn();
  const delivery = new SessionDelivery(() => {}, sent);
  const source = {};
  delivery.attach(source, true);
  const operation = await retain(delivery, source, stop),
    frame = new Uint8Array([0x20, 1]);
  operation.emitBinary(frame);
  await operation.release();
  await operation.release();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(operation.signal.aborted).toBe(true);
  expect(delivery.permitsBinary(source, frame)).toBe(false);
  operation.emitBinary(new Uint8Array([0x20, 2]));
  expect(sent).toHaveBeenCalledTimes(1);
  await delivery.close();
});
test("a disconnect tears down only its source and cannot revive a stale paint producer on reattach", async () => {
  const sent = vi.fn(),
    stop = vi.fn();
  const delivery = new SessionDelivery(() => {}, sent);
  const first = {},
    second = {};
  delivery.attach(first, true);
  delivery.attach(second, true);
  const a = await retain(delivery, first, stop),
    b = await retain(delivery, second);
  await delivery.detach(first);
  delivery.attach(first, true);
  a.emitBinary(new Uint8Array([0x20, 1]));
  b.emitBinary(new Uint8Array([0x20, 2]));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(sent).toHaveBeenCalledTimes(1);
  expect(sent.mock.calls[0][0]).toBe(second);
  await delivery.close();
});
test("stream ownership cannot be created without a current modern source", async () => {
  const delivery = new SessionDelivery(() => {});
  expect(() => delivery.binaryOperation(stopNothing)).toThrow("owned-source");
  const source = {};
  delivery.attach(source, false);
  await delivery.request(source, { type: "ping", requestId: "legacy-paint" }, async () => {
    expect(() => delivery.binaryOperation(stopNothing)).toThrow("owned-source");
  });
  await delivery.close();
});
test("ordinary retained operations preserve their existing accepted JSON reply behavior", async () => {
  const sent = vi.fn(),
    delivery = new SessionDelivery(sent);
  const source = {};
  delivery.attach(source, true);
  await delivery.request(source, { type: "ping", requestId: "ordinary" }, async () => {
    const operation = delivery.operation(
      () => true,
      () => {},
    );
    operation.emit({ type: "status", payload: { status: "error", message: "fixture" } });
    await operation.release();
  });
  expect(sent).toHaveBeenCalledTimes(1);
  expect(sent.mock.calls[0][0]).toBe(source);
  await delivery.close();
});
