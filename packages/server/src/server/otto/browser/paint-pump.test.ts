import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { BrowserPaintPump } from "./paint-pump.js";
const pumps: BrowserPaintPump[] = [];
const ticket = "01234567-89ab-4cde-8fab-0123456789ab",
  second = "11234567-89ab-4cde-8fab-0123456789ab";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  for (const pump of pumps.splice(0)) pump.close();
  vi.useRealTimers();
});
function fixture() {
  const ack = vi.fn(),
    demand = vi.fn(),
    pump = new BrowserPaintPump({ ack, demand });
  pumps.push(pump);
  const sink = { ticket, paint: vi.fn(), closed: vi.fn() };
  return { pump, ack, demand, sink };
}
function frame(sessionId: number) {
  const jpeg = new Uint8Array(40928);
  jpeg.set([0xff, 0xd8, sessionId]);
  jpeg.set([0xff, 0xd9], jpeg.length - 2);
  return { sessionId, viewportWidth: 390, viewportHeight: 844, jpeg };
}
test("capture starts only on demand; one held latest paint waits for viewer ack and idle byte credit", () => {
  const f = fixture();
  expect(f.demand).not.toHaveBeenCalled();
  f.pump.watch(f.sink);
  f.pump.receive(frame(1));
  f.pump.receive(frame(2));
  expect(f.sink.paint).toHaveBeenCalledTimes(1);
  expect(f.pump.acknowledge(ticket, 9)).toBe(false);
  expect(f.pump.acknowledge(ticket, 1)).toBe(true);
  vi.advanceTimersByTime(999);
  expect(f.sink.paint).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  expect(f.sink.paint).toHaveBeenCalledTimes(2);
  expect(f.sink.paint.mock.calls[1][0]).toMatchObject({ sequence: 2 });
});
test("input releases Chrome backpressure and uses the bounded interactive rate", () => {
  const f = fixture();
  f.pump.watch(f.sink);
  f.pump.receive(frame(1));
  f.pump.receive(frame(2));
  f.pump.acknowledge(ticket, 1);
  vi.advanceTimersByTime(100);
  f.pump.input();
  expect(f.ack).toHaveBeenCalledWith(2);
  vi.advanceTimersByTime(34);
  expect(f.sink.paint).toHaveBeenCalledTimes(2);
});
test("identical paint is deduplicated but a newly attached viewer still receives the static page", () => {
  const f = fixture();
  f.pump.watch(f.sink);
  f.pump.receive(frame(1));
  f.pump.acknowledge(ticket, 1);
  f.pump.receive(frame(1));
  vi.advanceTimersByTime(1000);
  expect(f.sink.paint).toHaveBeenCalledTimes(1);
  const peer = { ticket: second, paint: vi.fn(), closed: vi.fn() };
  f.pump.watch(peer);
  vi.advanceTimersByTime(1000);
  expect(peer.paint).toHaveBeenCalledTimes(1);
});
test("one slow source cannot accumulate packets or block another ready viewer", () => {
  const f = fixture(),
    peer = { ticket: second, paint: vi.fn(), closed: vi.fn() };
  f.pump.watch(f.sink);
  f.pump.watch(peer);
  f.pump.receive(frame(1));
  f.pump.receive(frame(2));
  f.pump.acknowledge(second, 1);
  vi.advanceTimersByTime(2000);
  expect(f.sink.paint).toHaveBeenCalledTimes(1);
  expect(peer.paint).toHaveBeenCalledTimes(2);
});
test("releasing the last viewer pauses capture, clears timers and frees held paints", () => {
  const f = fixture(),
    release = f.pump.watch(f.sink);
  f.pump.receive(frame(1));
  f.pump.receive(frame(2));
  f.pump.acknowledge(ticket, 1);
  release();
  expect(f.demand.mock.calls.map((call) => call[0])).toEqual([true, false]);
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(5000);
  expect(f.sink.paint).toHaveBeenCalledTimes(1);
  expect(f.ack).toHaveBeenCalledWith(2);
});
test("a faulty source is closed while another viewer continues", () => {
  const f = fixture(),
    peer = { ticket: second, paint: vi.fn(), closed: vi.fn() };
  f.sink.paint.mockImplementation(() => {
    throw new Error("fixture");
  });
  f.pump.watch(f.sink);
  f.pump.watch(peer);
  f.pump.receive(frame(1));
  expect(f.sink.closed).toHaveBeenCalledTimes(1);
  expect(peer.paint).toHaveBeenCalledTimes(1);
});
test("a viewport change cannot be deduplicated away even when the JPEG pixels match", () => {
  const f = fixture();
  f.pump.watch(f.sink);
  f.pump.receive(frame(1));
  f.pump.acknowledge(ticket, 1);
  f.pump.receive({ ...frame(1), viewportWidth: 780 });
  vi.advanceTimersByTime(1000);
  expect(f.sink.paint).toHaveBeenCalledTimes(2);
  expect(f.sink.paint.mock.calls[1][0]).toMatchObject({ viewportWidth: 780, sequence: 2 });
});
