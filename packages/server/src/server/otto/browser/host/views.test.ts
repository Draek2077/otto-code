import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SessionDelivery } from "../../../session/owned-subscriptions/index.js";
import {
  decodeBrowserPaintFrame,
  decodeBrowserPaintEnd,
} from "@getpaseo/protocol/otto/browser-frames";
import { BrowserPaintPump, type PaintSink } from "../paint-pump.js";
import { HostBrowserPages } from "./pages.js";
import { HostBrowserViews } from "./views.js";
const ticket = "01234567-89ab-4cde-8fab-0123456789ab";
const peerTicket = "11234567-89ab-4cde-8fab-0123456789ab";
const binding = { workspaceId: "workspace", cwd: "host-owned-project" };
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.useRealTimers();
});
function frame(sessionId: number) {
  return {
    sessionId,
    viewportWidth: 390,
    viewportHeight: 844,
    jpeg: new Uint8Array([0xff, 0xd8, sessionId, 0xff, 0xd9]),
  };
}
function fakePage() {
  let closed = false;
  const demand = vi.fn(),
    paint = new BrowserPaintPump({ ack: vi.fn(), demand });
  return {
    demand,
    paint,
    watch: (sink: PaintSink) => paint.watch(sink),
    isClosed: () => closed,
    close: async () => {
      closed = true;
      paint.close();
    },
  };
}
async function fixture() {
  const opened: ReturnType<typeof fakePage>[] = [];
  const open = vi.fn(async () => {
    const page = fakePage();
    opened.push(page);
    return page;
  });
  const pages = new HostBrowserPages({
    open,
    close: async () => {
      for (const page of opened) await page.close();
    },
  });
  const views = new HostBrowserViews(pages, async () => {}),
    sent: Array<{ source: object; bytes: Uint8Array }> = [],
    json = vi.fn();
  const delivery = new SessionDelivery(json, (source, bytes) => {
    expect(delivery.permitsBinary(source, bytes)).toBe(true);
    sent.push({ source, bytes });
  });
  const owner = {},
    peer = {};
  delivery.attach(owner, true);
  delivery.attach(peer, true);
  const source = (socket: object) => ({
    source: socket,
    retainBinary: (stop: () => void) => delivery.binaryOperation(stop),
  });
  const tab = await pages.create(binding, "https://example.test");
  const watch = (socket = owner, id = ticket) =>
    delivery.request(socket, { type: "ping", requestId: id }, () =>
      views.watch({ ...binding, browserId: tab.browserId, ticket: id }, source(socket)),
    );
  cleanups.push(async () => {
    await views.close();
    await pages.close();
    await delivery.close();
  });
  return { pages, views, delivery, sent, json, owner, peer, source, watch, tab, opened, open };
}
test("viewer paints remain bound to the requesting socket after its RPC ends; a peer cannot ack, detach or input", async () => {
  const f = await fixture();
  await f.watch();
  f.opened[0].paint.receive(frame(1));
  expect(f.sent).toHaveLength(1);
  expect(f.sent[0].source).toBe(f.owner);
  expect(decodeBrowserPaintFrame(f.sent[0].bytes)).toMatchObject({ ticket, sequence: 1 });
  expect(f.views.acknowledge(ticket, 1, f.source(f.peer), binding.workspaceId)).toBe(false);
  await f.views.detach(ticket, f.source(f.peer), binding.workspaceId);
  const input = vi.fn(async () => {});
  await expect(f.views.input(ticket, f.source(f.peer), input, binding.workspaceId)).rejects.toThrow(
    "own",
  );
  expect(input).not.toHaveBeenCalled();
  expect(f.views.acknowledge(ticket, 1, f.source(f.owner), binding.workspaceId)).toBe(true);
  expect(f.json).not.toHaveBeenCalled();
});
test("source detach clears only its capture demand and blocks late frame/input producers", async () => {
  const f = await fixture();
  await f.watch();
  await f.watch(f.peer, peerTicket);
  await f.delivery.detach(f.owner);
  f.opened[0].paint.receive(frame(1));
  expect(f.sent.map((entry) => entry.source)).toEqual([f.peer]);
  await expect(
    f.views.input(ticket, f.source(f.owner), async () => {}, binding.workspaceId),
  ).rejects.toThrow();
  await f.views.detach(peerTicket, f.source(f.peer), binding.workspaceId);
  expect(f.opened[0].demand.mock.calls.map((call) => call[0])).toEqual([true, false]);
  expect(f.delivery.registrationCount).toBe(0);
});
test("page closure sends a terminal ticket notice and releases the source registration", async () => {
  const f = await fixture();
  await f.watch();
  await f.opened[0].close();
  expect(decodeBrowserPaintEnd(f.sent[0].bytes)).toEqual({ ticket, reason: "error" });
  expect(f.delivery.registrationCount).toBe(0);
  expect(f.views.acknowledge(ticket, 1, f.source(f.owner), binding.workspaceId)).toBe(false);
});
test("a viewer's input and frame acknowledgments remain usable while an agent waits on the same page", async () => {
  const f = await fixture();
  await f.watch();
  let finish!: () => void, started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const wait = f.pages.use(binding.workspaceId, f.tab.browserId, async () => {
    started();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  await ready;
  f.opened[0].paint.receive(frame(1));
  expect(f.views.acknowledge(ticket, 1, f.source(f.owner), binding.workspaceId)).toBe(true);
  const input = vi.fn(async () => {});
  await f.views.input(ticket, f.source(f.owner), input, binding.workspaceId);
  expect(input).toHaveBeenCalledTimes(1);
  finish();
  await wait;
});
test("invalid, duplicate and cross-workspace tickets cannot acquire page or source authority", async () => {
  const f = await fixture();
  await expect(f.watch(f.owner, "invalid")).rejects.toThrow();
  await f.watch();
  await expect(f.watch(f.peer)).rejects.toThrow();
  await f.delivery.request(f.peer, { type: "ping", requestId: "wrong-workspace" }, async () => {
    await expect(
      f.views.watch(
        { workspaceId: "peer", browserId: f.tab.browserId, ticket: peerTicket },
        f.source(f.peer),
      ),
    ).rejects.toThrow("workspace");
  });
  expect(f.delivery.registrationCount).toBe(1);
  expect(f.open).toHaveBeenCalledTimes(1);
});
test("disconnect during a suspended page's wake cannot retain a late viewer", async () => {
  const f = await fixture();
  await vi.advanceTimersByTimeAsync(300_000);
  let opened!: (page: ReturnType<typeof fakePage>) => void, started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.open.mockImplementationOnce(async () => {
    started();
    return new Promise((resolve) => {
      opened = resolve;
    });
  });
  const pending = f.watch();
  const failed = expect(pending).rejects.toThrow("disconnected");
  await ready;
  await f.delivery.detach(f.owner);
  const page = fakePage();
  opened(page);
  await failed;
  expect(f.delivery.registrationCount).toBe(0);
  expect(page.demand).not.toHaveBeenCalled();
  expect(f.sent).toEqual([]);
});
test("a ticket cannot be replayed through another workspace even on its owning connection", async () => {
  const f = await fixture();
  await f.watch();
  f.opened[0].paint.receive(frame(1));
  expect(f.views.acknowledge(ticket, 1, f.source(f.owner), "peer")).toBe(false);
  await f.views.detach(ticket, f.source(f.owner), "peer");
  await expect(f.views.input(ticket, f.source(f.owner), async () => {}, "peer")).rejects.toThrow();
  expect(f.views.acknowledge(ticket, 1, f.source(f.owner), binding.workspaceId)).toBe(true);
});
