import { expect, test, vi } from "vitest";
import {
  encodeBrowserPaintFrame,
  encodeBrowserPaintEnd,
} from "@getpaseo/protocol/otto/browser-frames";
import { BrowserPaintSubscriptions } from "./browser-paints.js";
const ticket = "01234567-89ab-4cde-8fab-0123456789ab",
  other = "11234567-89ab-4cde-8fab-0123456789ab";
function paint(sequence: number, id = ticket) {
  return encodeBrowserPaintFrame({
    ticket: id,
    sequence,
    viewportWidth: 390,
    viewportHeight: 844,
    jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  });
}
test("paint-end releases only its registered viewer and invalidates all later frames", () => {
  const hub = new BrowserPaintSubscriptions(),
    observer = { paint: vi.fn(), closed: vi.fn() },
    peer = { paint: vi.fn(), closed: vi.fn() };
  hub.observe(ticket, observer);
  hub.observe(other, peer);
  const invalid = encodeBrowserPaintEnd({ ticket, reason: "error" });
  invalid[3] = 9;
  hub.handle(invalid);
  expect(observer.closed).not.toHaveBeenCalled();
  hub.handle(encodeBrowserPaintEnd({ ticket, reason: "error" }));
  hub.handle(paint(1));
  hub.handle(paint(1, other));
  expect(observer.closed).toHaveBeenCalledExactlyOnceWith("error");
  expect(observer.paint).not.toHaveBeenCalled();
  expect(peer.paint).toHaveBeenCalledTimes(1);
  expect(peer.closed).not.toHaveBeenCalled();
});
test("only the registered ticket receives paint; duplicates, old frames and other domains stay isolated", () => {
  const hub = new BrowserPaintSubscriptions(),
    observer = { paint: vi.fn(), closed: vi.fn() };
  hub.observe(ticket, observer);
  expect(hub.handle(new Uint8Array([1, 0]))).toBe(false);
  expect(hub.handle(paint(1, other))).toBe(true);
  hub.handle(paint(2));
  hub.handle(paint(2));
  hub.handle(paint(1));
  expect(observer.paint).toHaveBeenCalledTimes(1);
  expect(observer.paint.mock.calls[0][0]).toMatchObject({ ticket, sequence: 2 });
});
test("disconnect invalidates all old tickets before reconnect and release is identity-bound", () => {
  const hub = new BrowserPaintSubscriptions(),
    first = { paint: vi.fn(), closed: vi.fn() },
    second = { paint: vi.fn(), closed: vi.fn() };
  const release = hub.observe(ticket, first);
  hub.disconnected();
  hub.handle(paint(1));
  expect(first.closed).toHaveBeenCalledTimes(1);
  expect(first.paint).not.toHaveBeenCalled();
  hub.observe(ticket, second);
  release();
  hub.handle(paint(1));
  expect(second.paint).toHaveBeenCalledTimes(1);
});
test("malformed paint is consumed without image delivery or breaking another ticket", () => {
  const hub = new BrowserPaintSubscriptions(),
    observer = { paint: vi.fn(), closed: vi.fn() };
  hub.observe(ticket, observer);
  hub.handle(new Uint8Array([0x20]));
  const invalid = paint(1);
  invalid[1] = 2;
  hub.handle(invalid);
  expect(observer.paint).not.toHaveBeenCalled();
  hub.handle(paint(2));
  expect(observer.paint).toHaveBeenCalledTimes(1);
});
test("a faulty observer is released without crashing the connection or another viewer", () => {
  const hub = new BrowserPaintSubscriptions(),
    closed = vi.fn(),
    second = { paint: vi.fn(), closed: vi.fn() };
  hub.observe(ticket, {
    paint() {
      throw new Error("fixture");
    },
    closed,
  });
  hub.observe(other, second);
  expect(() => hub.handle(paint(1))).not.toThrow();
  hub.handle(paint(1, other));
  expect(closed).toHaveBeenCalledTimes(1);
  expect(second.paint).toHaveBeenCalledTimes(1);
});
test("a second observer cannot replace a live ticket", () => {
  const hub = new BrowserPaintSubscriptions(),
    observer = { paint: vi.fn(), closed: vi.fn() };
  hub.observe(ticket, observer);
  expect(() => hub.observe(ticket, observer)).toThrow("already registered");
});
test("ticket identity is case-insensitive and invalid registrations fail before any RPC", () => {
  const hub = new BrowserPaintSubscriptions(),
    observer = { paint: vi.fn(), closed: vi.fn() };
  expect(() => hub.observe("not-a-ticket", observer)).toThrow("Invalid");
  hub.observe(ticket.toUpperCase(), observer);
  hub.handle(paint(1));
  expect(observer.paint).toHaveBeenCalledTimes(1);
  expect(() => hub.observe(ticket, observer)).toThrow("already registered");
});
test("disconnect notifications cannot re-register into the closing source or loop its teardown", () => {
  const hub = new BrowserPaintSubscriptions(),
    observerPaint = vi.fn();
  const replacement = { paint: observerPaint, closed: vi.fn() };
  const closed = vi.fn(() => {
    expect(() => hub.observe(ticket, replacement)).toThrow("closing");
  });
  hub.observe(ticket, { paint: observerPaint, closed });
  hub.disconnected();
  hub.handle(paint(1));
  expect(closed).toHaveBeenCalledTimes(1);
  expect(observerPaint).not.toHaveBeenCalled();
});
