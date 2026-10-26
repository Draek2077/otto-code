import { expect, test, vi } from "vitest";
import type { BrowserPaintFrame } from "@getpaseo/protocol/otto/browser-frames";
import type { HostBrowserTab, HostBrowserInput } from "@getpaseo/plugin/otto/host-browser";
import { HostBrowserViewer, type HostViewerPort } from "./viewer-model";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tab: HostBrowserTab = {
  browserId: "browser",
  workspaceId: "workspace",
  title: "Proof",
  url: "http://localhost:3000",
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  state: "ready",
  error: null,
  viewportWidth: 390,
  viewportHeight: 844,
};
function fixture() {
  const pending = deferred<HostBrowserTab>();
  const observers: Array<Parameters<HostViewerPort["observe"]>[1]> = [];
  const tickets: string[] = [];
  const release = vi.fn(),
    update = vi.fn(),
    detach = vi.fn(async () => {});
  const acknowledge = vi.fn(async () => true),
    input = vi.fn(async (_event: HostBrowserInput) => {});
  const port: HostViewerPort = {
    ticket: () => {
      const ticket = `00000000-0000-4000-8000-${String(tickets.length).padStart(12, "0")}`;
      tickets.push(ticket);
      return ticket;
    },
    observe: (_ticket, observer) => {
      observers.push(observer);
      return release;
    },
    watch: vi.fn(() => pending.promise),
    detach,
    acknowledge,
    input: (_ticket, event) => input(event),
    update,
  };
  const viewer = new HostBrowserViewer(port);
  const paint = (sequence = 1, observer = 0) => {
    const frame: BrowserPaintFrame = {
      ticket: tickets[observer],
      sequence,
      viewportWidth: 390,
      viewportHeight: 844,
      jpeg: new Uint8Array([255, 216, 255, 217]),
    };
    observers[observer].paint(frame);
    return frame;
  };
  return {
    viewer,
    pending,
    paint,
    observers,
    tickets,
    release,
    update,
    detach,
    acknowledge,
    input,
    port,
  };
}
test("registers paint before watch, retains one image, and acknowledges only its decoder", async () => {
  const f = fixture(),
    hide = f.viewer.activate();
  expect(f.port.watch).toHaveBeenCalledOnce();
  const first = f.paint();
  expect(f.viewer.getSnapshot().frame).toBe(first);
  expect(f.acknowledge).not.toHaveBeenCalled();
  f.viewer.displayed(1);
  f.viewer.displayed(1);
  expect(f.acknowledge).toHaveBeenCalledExactlyOnceWith(f.tickets[0], 1);
  f.paint(2);
  f.paint(1);
  expect(f.viewer.getSnapshot().frame?.sequence).toBe(2);
  f.viewer.displayed(1);
  expect(f.acknowledge).toHaveBeenCalledOnce();
  hide();
  expect(f.release).toHaveBeenCalledOnce();
  expect(f.viewer.getSnapshot()).toEqual({ phase: "inactive", frame: null, error: null });
  f.pending.resolve(tab);
  await Promise.resolve();
  expect(f.update).not.toHaveBeenCalled();
  expect(f.detach).toHaveBeenCalledTimes(2);
});
test("old frames, late watch replies and old cleanup cannot mutate a later opening", async () => {
  const f = fixture(),
    oldHide = f.viewer.activate();
  f.paint();
  oldHide();
  const hide = f.viewer.activate();
  f.paint(99, 0);
  oldHide();
  expect(f.viewer.getSnapshot().phase).toBe("connecting");
  f.pending.resolve(tab);
  await Promise.resolve();
  expect(f.update).toHaveBeenCalledOnce();
  expect(f.detach).toHaveBeenLastCalledWith(f.tickets[0]);
  f.paint(1, 1);
  expect(f.viewer.getSnapshot().frame?.ticket).toBe(f.tickets[1]);
  hide();
});
test("source disconnect and image decode failure release image, input and subscription", () => {
  const f = fixture();
  f.viewer.activate();
  f.paint();
  f.observers[0].closed();
  expect(f.viewer.getSnapshot().phase).toBe("ended");
  expect(f.viewer.getSnapshot().frame).toBeNull();
  const hide = f.viewer.activate();
  f.paint(1, 1);
  f.viewer.decodeFailed(1);
  expect(f.viewer.getSnapshot().phase).toBe("error");
  expect(f.viewer.getSnapshot().frame).toBeNull();
  expect(f.release).toHaveBeenCalledTimes(2);
  hide();
});
test("a failed watch never retries, exposes no raw error and ignores later paint", async () => {
  const f = fixture();
  f.viewer.activate();
  f.pending.reject(new Error("secret host diagnostic"));
  await Promise.resolve();
  f.paint();
  expect(f.viewer.getSnapshot().phase).toBe("error");
  expect(f.viewer.getSnapshot().error).not.toContain("secret");
  expect(f.port.watch).toHaveBeenCalledOnce();
  expect(f.release).toHaveBeenCalledOnce();
});
test("serializes keys, coalesces adjacent motion and preserves boundaries", async () => {
  const f = fixture(),
    blocked = deferred<void>();
  f.input.mockImplementationOnce(() => blocked.promise);
  const hide = f.viewer.activate();
  f.paint();
  f.viewer.input({ kind: "key", phase: "down", key: "Shift" });
  f.viewer.input({ kind: "pointer", phase: "move", button: "left", x: 1, y: 1 });
  f.viewer.input({ kind: "pointer", phase: "move", button: "left", x: 2, y: 2 });
  f.viewer.input({ kind: "pointer", phase: "down", button: "left", x: 2, y: 2 });
  f.viewer.input({ kind: "wheel", x: 2, y: 2, deltaX: 1, deltaY: 10 });
  f.viewer.input({ kind: "wheel", x: 3, y: 3, deltaX: 2, deltaY: 20 });
  f.viewer.input({ kind: "key", phase: "up", key: "Shift" });
  expect(f.input).toHaveBeenCalledOnce();
  blocked.resolve();
  await vi.waitFor(() => expect(f.input).toHaveBeenCalledTimes(5));
  expect(f.input.mock.calls.map(([event]) => event)).toEqual([
    { kind: "key", phase: "down", key: "Shift" },
    { kind: "pointer", phase: "move", button: "left", x: 2, y: 2 },
    { kind: "pointer", phase: "down", button: "left", x: 2, y: 2 },
    { kind: "wheel", x: 3, y: 3, deltaX: 3, deltaY: 30 },
    { kind: "key", phase: "up", key: "Shift" },
  ]);
  hide();
});
test("hiding drops unsent input without claiming to cancel a native operation", async () => {
  const f = fixture(),
    blocked = deferred<void>();
  f.input.mockImplementationOnce(() => blocked.promise);
  const hide = f.viewer.activate();
  f.paint();
  f.viewer.input({ kind: "key", phase: "down", key: "Control" });
  f.viewer.input({ kind: "text", text: "must not be sent" });
  hide();
  blocked.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(f.input).toHaveBeenCalledOnce();
  expect(f.detach).toHaveBeenCalledOnce();
});
test.each(["failure", "overflow"])(
  "ends a viewer on input %s instead of losing held input silently",
  async (mode) => {
    const f = fixture(),
      blocked = deferred<void>();
    f.input.mockImplementationOnce(() => blocked.promise);
    f.viewer.activate();
    f.paint();
    f.viewer.input({ kind: "key", phase: "down", key: "Shift" });
    if (mode === "failure") blocked.reject(new Error("unsafe native diagnostic"));
    else
      for (let index = 0; index < 65; index++)
        f.viewer.input({ kind: "text", text: String(index) });
    await Promise.resolve();
    await Promise.resolve();
    expect(f.viewer.getSnapshot().phase).toBe("error");
    expect(f.viewer.getSnapshot().frame).toBeNull();
    expect(f.detach).toHaveBeenCalledOnce();
    if (mode === "overflow") blocked.resolve();
  },
);
test("a stale negative acknowledgment cannot close the next viewer", async () => {
  const f = fixture(),
    ack = deferred<boolean>();
  f.acknowledge.mockImplementationOnce(() => ack.promise);
  const hide = f.viewer.activate();
  f.paint();
  f.viewer.displayed(1);
  hide();
  const second = f.viewer.activate();
  f.paint(1, 1);
  ack.resolve(false);
  await Promise.resolve();
  expect(f.viewer.getSnapshot().phase).toBe("live");
  second();
});
