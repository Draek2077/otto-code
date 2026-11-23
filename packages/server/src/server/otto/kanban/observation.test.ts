import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BoardRead } from "@getpaseo/plugin/otto/kanban";
import { KanbanObservations, KANBAN_POLL_INTERVAL_MS } from "./observation.js";

const binding = { hostId: "host", projectId: "project" };
const initial: BoardRead = { status: "unconfigured", binding, settingsRevision: "one" };
const opened: KanbanObservations[] = [];
function fixture() {
  let result = initial;
  const read = vi.fn(async () => result);
  const observations = new KanbanObservations(read);
  opened.push(observations);
  return {
    read,
    observations,
    change: (value: BoardRead) => {
      result = value;
    },
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  for (const observation of opened.splice(0)) await observation.close();
  vi.useRealTimers();
});
it("constructs without reading and shares one poll across paired viewers", async () => {
  const f = fixture();
  expect(f.read).not.toHaveBeenCalled();
  const [a, b] = await Promise.all([
    f.observations.wait("a", "one", binding, null),
    f.observations.wait("b", "two", binding, null),
  ]);
  expect(a).toEqual(b);
  expect(f.read).toHaveBeenCalledTimes(1);
});
it("returns unchanged heartbeat cursors and invalidates changed canonical reads", async () => {
  const f = fixture();
  const first = await f.observations.wait("a", "one", binding, null);
  const heartbeat = f.observations.wait("a", "one", binding, first.cursor);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(await heartbeat).toEqual(first);
  f.change({ ...initial, settingsRevision: "two" });
  const changed = f.observations.wait("a", "one", binding, first.cursor);
  await vi.advanceTimersByTimeAsync(10_000);
  expect((await changed).cursor).not.toBe(first.cursor);
  expect(f.read).toHaveBeenCalledTimes(2);
});
it("stops polling immediately after the final viewer releases", async () => {
  const f = fixture();
  await f.observations.wait("a", "one", binding, null);
  await f.observations.wait("b", "two", binding, null);
  f.observations.releaseClient("a");
  await vi.advanceTimersByTimeAsync(KANBAN_POLL_INTERVAL_MS);
  expect(f.read).toHaveBeenCalledTimes(2);
  f.observations.release("b", "two");
  await vi.advanceTimersByTimeAsync(300_000);
  expect(f.read).toHaveBeenCalledTimes(2);
});
it("detects issue content changes even when the provider's board marker stays fixed", async () => {
  const f = fixture();
  const board = {
    provider: "github",
    id: "board",
    title: "Board",
    url: null,
    revision: "unchanged",
    capabilities: {
      read: true,
      create: false,
      link: false,
      move: false,
      edit: false,
      remove: false,
    },
    columns: [{ id: "todo", title: "Todo" }],
    cards: [
      {
        id: "issue",
        title: "Before",
        description: "Body",
        url: null,
        columnId: "todo",
        kind: "issue",
        assignees: [],
        archived: false,
      },
    ],
  };
  f.change({ status: "ready", binding, settingsRevision: "one", board });
  const first = await f.observations.wait("a", "one", binding, null);
  const heartbeat = f.observations.wait("a", "one", binding, first.cursor);
  await vi.advanceTimersByTimeAsync(20_000);
  await heartbeat;
  f.change({
    status: "ready",
    binding,
    settingsRevision: "one",
    board: { ...board, cards: [{ ...board.cards[0], title: "Changed externally" }] },
  });
  const changed = f.observations.wait("a", "one", binding, first.cursor);
  await vi.advanceTimersByTimeAsync(10_000);
  expect((await changed).cursor).not.toBe(first.cursor);
});
it("expires abandoned leases without treating a heartbeat as a board change", async () => {
  const f = fixture();
  await f.observations.wait("a", "one", binding, null);
  await vi.advanceTimersByTimeAsync(300_000);
  expect(f.read).toHaveBeenCalledTimes(2);
});
it("cannot retarget a lease or release another paired client's demand", async () => {
  const f = fixture();
  const first = await f.observations.wait("a", "one", binding, null);
  await expect(
    f.observations.wait("a", "one", { ...binding, projectId: "other" }, null),
  ).rejects.toThrow("changed project");
  f.observations.release("b", "one");
  const waiting = f.observations.wait("a", "one", binding, first.cursor);
  await expect(f.observations.wait("a", "one", binding, first.cursor)).rejects.toThrow(
    "pending wait",
  );
  f.observations.releaseClient("a");
  await expect(waiting).rejects.toThrow("released");
});
it("bounds per-client leases before admitting more provider work", async () => {
  const f = fixture();
  for (let index = 0; index < 8; index++)
    await f.observations.wait("a", String(index), binding, null);
  await expect(f.observations.wait("a", "ninth", binding, null)).rejects.toThrow("Too many");
  expect(f.read).toHaveBeenCalledTimes(1);
});
it("does not reschedule a slow read released before its response", async () => {
  const f = fixture();
  let complete!: (value: BoardRead) => void;
  f.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const waiting = f.observations.wait("a", "one", binding, null);
  const rejected = expect(waiting).rejects.toThrow("released");
  await vi.advanceTimersByTimeAsync(30_000);
  expect(f.read).toHaveBeenCalledTimes(1);
  f.observations.releaseClient("a");
  complete(initial);
  await rejected;
  await vi.advanceTimersByTimeAsync(300_000);
  expect(f.read).toHaveBeenCalledTimes(1);
});
it("closes pending waits and refuses new subscriptions after shutdown", async () => {
  const f = fixture();
  const first = await f.observations.wait("a", "one", binding, null);
  const waiting = f.observations.wait("a", "one", binding, first.cursor);
  const rejected = expect(waiting).rejects.toThrow("released");
  await f.observations.close();
  await rejected;
  await expect(f.observations.wait("a", "one", binding, null)).rejects.toThrow("live paired");
  await vi.advanceTimersByTimeAsync(300_000);
  expect(f.read).toHaveBeenCalledTimes(1);
});
it("backs off failed reads and announces recovery without exposing an exception", async () => {
  const f = fixture();
  f.read.mockRejectedValueOnce(new Error("private CLI diagnostics"));
  let last = await f.observations.wait("a", "one", binding, null);
  for (let index = 0; index < 2; index++) {
    const next = f.observations.wait("a", "one", binding, last.cursor);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await next).toEqual(last);
  }
  expect(f.read).toHaveBeenCalledTimes(1);
  const recovered = f.observations.wait("a", "one", binding, last.cursor);
  await vi.advanceTimersByTimeAsync(20_000);
  last = await recovered;
  expect(last).toEqual({ cursor: expect.any(String) });
  expect(f.read).toHaveBeenCalledTimes(2);
});
