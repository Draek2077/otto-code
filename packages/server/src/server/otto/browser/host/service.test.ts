import { afterEach, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { BrowserToolsBroker } from "../../../browser-tools/broker.js";
import { BrowserAdmissions } from "../admission.js";
import { BrowserPaintPump, type PaintSink } from "../paint-pump.js";
import { HostBrowserPages } from "./pages.js";
import { HostBrowserService, OTTO_BROWSER_HOST_ID } from "./service.js";
import { SessionDelivery } from "../../../session/owned-subscriptions/index.js";
import { hostBrowserRequestSource } from "./source.js";
import {
  readHostBrowserTabs,
  executeHostBrowser,
  watchHostBrowser,
  detachHostBrowser,
} from "@getpaseo/plugin/otto/host-browser";
import type {
  BrowserAutomationCommand,
  BrowserAutomationExecuteRequest,
  BrowserAutomationResult,
  BrowserAutomationDialogEvent,
} from "@getpaseo/protocol/browser-automation/rpc-schemas";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const scope = { hostId: "host", workspaceId: "workspace" };
function fixture() {
  const admission = new BrowserAdmissions({
    previewTarget: async () => null,
    lookup: async () => [{ address: "127.0.0.1" }],
  });
  const broker = new BrowserToolsBroker({
    ottoNewTabHostId: () => OTTO_BROWSER_HOST_ID,
    ottoAdmission: (input, next) => admission.execute(input, next),
  });
  const pumps: BrowserPaintPump[] = [];
  const open = vi.fn(async () => {
    const paint = new BrowserPaintPump({ ack: () => {}, demand: () => {} });
    pumps.push(paint);
    let closed = false;
    return {
      paint,
      watch: (sink: PaintSink) => paint.watch(sink),
      isClosed: () => closed,
      close: async () => {
        closed = true;
        paint.close();
      },
    };
  });
  const pages = new HostBrowserPages({
    open,
    close: async () => {
      for (const pump of pumps) pump.close();
    },
  });
  let archived = false;
  const execute = vi.fn(
    async (
      tab: { browserId: string; workspaceId: string },
      _page: unknown,
      command: BrowserAutomationCommand,
    ): Promise<BrowserAutomationResult> => {
      if (command.command !== "navigate") throw new Error("Unexpected fixture operation");
      pages.update(tab.workspaceId, tab.browserId, { url: command.args.url });
      return { command: command.command, browserId: tab.browserId, url: command.args.url };
    },
  );
  const input = vi.fn(async () => {});
  const dialogs = vi.fn((): BrowserAutomationDialogEvent[] => []);
  const getWorkspace = vi.fn(async (id: string) =>
    id === "workspace" || id === "peer"
      ? { cwd: `host-root/${id}`, archivedAt: archived ? "archived" : null }
      : null,
  );
  const service = new HostBrowserService({
    hostId: scope.hostId,
    broker,
    pages,
    execute,
    input,
    clear: () => {},
    dialogs,
    workspaces: { get: getWorkspace },
  });
  service.register();
  const desktop: BrowserAutomationExecuteRequest[] = [],
    desktopId = randomUUID();
  broker.registerClient({
    id: "desktop",
    hostKind: "desktop",
    supportedCommands: ["new_tab", "navigate", "list_tabs"],
    sendBrowserAutomationRequest: (request) => {
      desktop.push(request);
      let result: BrowserAutomationResult;
      switch (request.command.command) {
        case "list_tabs":
          result = { command: "list_tabs", tabs: [] };
          break;
        case "new_tab":
          result = {
            command: "new_tab",
            browserId: desktopId,
            workspaceId: request.workspaceId!,
            url: "https://native.test",
          };
          break;
        default:
          result = { command: "navigate", browserId: desktopId, url: "https://native.test/next" };
      }
      broker.receiveResponse(
        {
          type: "browser.automation.execute.response",
          payload: { requestId: request.requestId, ok: true, result },
        },
        ["desktop"],
      );
    },
  });
  const delivery = new SessionDelivery(() => {}),
    socket = {};
  delivery.attach(socket, true);
  const call = (method: string, value: unknown) => service.invoke(method, value);
  const owned = async (method: string, value: unknown) => {
    let output: unknown;
    await delivery.request(socket, { type: "ping", requestId: randomUUID() }, async () => {
      output = await service.invoke(method, value, hostBrowserRequestSource(delivery));
    });
    return output;
  };
  cleanups.push(async () => {
    await service.close();
    await delivery.close();
  });
  return {
    broker,
    service,
    call,
    owned,
    pages,
    open,
    desktop,
    desktopId,
    execute,
    input,
    dialogs,
    getWorkspace,
    delivery,
    archive: () => {
      archived = true;
    },
  };
}
async function create(f: ReturnType<typeof fixture>) {
  const result = executeHostBrowser.output.parse(
    await f.call(executeHostBrowser.name, {
      ...scope,
      command: { command: "new_tab", args: { url: "https://example.test" } },
    }),
  );
  if (!result.ok || result.result.command !== "new_tab") throw new Error("No fixture tab");
  return result.result.browserId;
}
test("host inventory is scoped and inert; desktop reconnect does not take over hosted creates", async () => {
  const f = fixture();
  expect(readHostBrowserTabs.output.parse(await f.call(readHostBrowserTabs.name, scope))).toEqual({
    ok: true,
    value: [],
  });
  expect(f.open).not.toHaveBeenCalled();
  const id = await create(f);
  expect(f.pages.get(scope.workspaceId, id).url).toBe("https://example.test");
  expect(f.desktop.filter((request) => request.command.command === "new_tab")).toEqual([]);
});
test("manual native creates keep native affinity and an explicit hosted command cannot claim them", async () => {
  const f = fixture();
  await f.broker.execute({
    workspaceId: scope.workspaceId,
    ottoBrowserHostId: "desktop",
    command: { command: "new_tab", args: {} },
  });
  const hostId = await create(f);
  await f.broker.execute({
    workspaceId: scope.workspaceId,
    command: {
      command: "navigate",
      args: { browserId: f.desktopId, url: "https://native.test/next" },
    },
  });
  await f.broker.execute({
    workspaceId: scope.workspaceId,
    command: { command: "navigate", args: { browserId: hostId, url: "https://example.test/next" } },
  });
  expect(f.execute).toHaveBeenCalledTimes(1);
  expect(f.desktop.filter((request) => request.command.command === "navigate")).toHaveLength(1);
  const rejected = executeHostBrowser.output.parse(
    await f.call(executeHostBrowser.name, {
      ...scope,
      command: {
        command: "navigate",
        args: { browserId: f.desktopId, url: "https://example.test" },
      },
    }),
  );
  expect(rejected.ok).toBe(false);
});
test("wrong host, unknown workspace and cross-workspace browser IDs cannot execute", async () => {
  const f = fixture(),
    id = await create(f);
  for (const binding of [
    { ...scope, hostId: "peer" },
    { ...scope, workspaceId: "missing" },
    { ...scope, workspaceId: "peer" },
  ]) {
    const result = executeHostBrowser.output.parse(
      await f.call(executeHostBrowser.name, {
        ...binding,
        command: { command: "navigate", args: { browserId: id, url: "https://example.test/next" } },
      }),
    );
    expect(result.ok).toBe(false);
  }
  expect(f.execute).not.toHaveBeenCalled();
});
test("hosted agent creates share the broker's metadata guard and combined tab limit", async () => {
  const f = fixture();
  for (let index = 0; index < 12; index++) {
    const created = await f.broker.execute({
      workspaceId: scope.workspaceId,
      agentId: "agent",
      command: { command: "new_tab", args: { url: "https://example.test" } },
    });
    expect(created.ok).toBe(true);
  }
  const rejected = executeHostBrowser.output.parse(
    await f.broker.execute({
      workspaceId: scope.workspaceId,
      agentId: "agent",
      command: { command: "new_tab", args: { url: "https://example.test/extra" } },
    }),
  );
  expect(rejected.ok).toBe(false);
  expect(f.pages.list(scope.workspaceId)).toHaveLength(12);
  const denied = executeHostBrowser.output.parse(
    await f.call(executeHostBrowser.name, {
      ...scope,
      command: { command: "new_tab", args: { url: "http://169.254.169.254/latest" } },
    }),
  );
  expect(denied.ok).toBe(false);
});
test("an unavailable hosted runtime never silently launches in the user's native profile", async () => {
  const f = fixture();
  f.open.mockRejectedValueOnce(new Error("runtime unavailable"));
  const result = executeHostBrowser.output.parse(
    await f.call(executeHostBrowser.name, {
      ...scope,
      command: { command: "new_tab", args: { url: "https://example.test" } },
    }),
  );
  expect(result.ok).toBe(false);
  expect(f.pages.list(scope.workspaceId)).toEqual([]);
  expect(f.desktop.filter((request) => request.command.command === "new_tab")).toEqual([]);
});
test("viewer release remains legal after archival, without granting input or new-page authority", async () => {
  const f = fixture(),
    id = await create(f),
    ticket = randomUUID();
  const started = watchHostBrowser.output.parse(
    await f.owned(watchHostBrowser.name, { ...scope, browserId: id, ticket }),
  );
  expect(started.ok).toBe(true);
  expect(f.delivery.registrationCount).toBe(1);
  f.archive();
  expect(
    detachHostBrowser.output.parse(await f.owned(detachHostBrowser.name, { ...scope, ticket })),
  ).toEqual({ ok: true, value: true });
  expect(f.delivery.registrationCount).toBe(0);
  const rejected = executeHostBrowser.output.parse(
    await f.call(executeHostBrowser.name, { ...scope, command: { command: "new_tab", args: {} } }),
  );
  expect(rejected.ok).toBe(false);
});
test("host dialog policy results are returned once with a bounded event count", async () => {
  const f = fixture();
  f.dialogs.mockReturnValueOnce(
    Array.from({ length: 20 }, (_, index) => ({
      type: "alert",
      message: String(index),
      action: "accepted",
      timestamp: index,
    })),
  );
  const response = await f.broker.execute({
    workspaceId: scope.workspaceId,
    command: { command: "new_tab", args: { url: "https://example.test" } },
  });
  expect(response.ok).toBe(true);
  expect(response.dialogs).toHaveLength(10);
  expect(response.dialogs?.[0].message).toBe("10");
});
test("hiding during workspace validation cannot leave a late viewer attached", async () => {
  const f = fixture(),
    browserId = await create(f),
    ticket = randomUUID();
  let resume!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
      resume = resolve;
    }),
    ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
  f.getWorkspace.mockImplementationOnce(async () => {
    entered();
    await gate;
    return { cwd: "host-root/workspace", archivedAt: null };
  });
  const pending = f.owned(watchHostBrowser.name, { ...scope, browserId, ticket });
  await ready;
  await f.owned(detachHostBrowser.name, { ...scope, ticket });
  resume();
  expect(watchHostBrowser.output.parse(await pending).ok).toBe(false);
  expect(f.delivery.registrationCount).toBe(0);
});
