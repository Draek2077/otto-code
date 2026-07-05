import { describe, expect, test } from "vitest";

import type { OttoToolResult } from "../agent/tools/types.js";
import type { BrowserToolsExecuteInput } from "../browser-tools/broker.js";
import type { BrowserToolsResponsePayload } from "../browser-tools/errors.js";
import type { PreviewServerSummary } from "./dev-server-manager.js";
import { registerPreviewTools, type PreviewDevServerHost } from "./preview-tools.js";

const SERVER_URL = "http://127.0.0.1:8202/";
const TAB_A = "11111111-1111-4111-8111-111111111111";
const TAB_B = "22222222-2222-4222-8222-222222222222";

function summary(overrides?: Partial<PreviewServerSummary>): PreviewServerSummary {
  return {
    serverId: "srv_test",
    name: "sample",
    cwd: "C:\\work\\project",
    port: 8202,
    url: SERVER_URL,
    status: "running",
    pid: 1234,
    exitCode: null,
    boundBrowserId: null,
    ...overrides,
  };
}

function newTabPayload(browserId: string): BrowserToolsResponsePayload {
  return {
    requestId: "req-new-tab",
    ok: true,
    result: { command: "new_tab", browserId, workspaceId: "wks_1", url: SERVER_URL },
  };
}

function listTabsPayload(
  tabs: Array<{ browserId: string; url: string }>,
): BrowserToolsResponsePayload {
  return {
    requestId: "req-list-tabs",
    ok: true,
    result: {
      command: "list_tabs",
      tabs: tabs.map((tab) => ({
        browserId: tab.browserId,
        url: tab.url,
        title: "Tab",
        isActive: true,
        isLoading: false,
      })),
    },
  };
}

function noHostPayload(): BrowserToolsResponsePayload {
  return {
    requestId: "req-no-host",
    ok: false,
    error: {
      code: "browser_no_host",
      message: "No Otto browser host is connected",
      retryable: true,
    },
  };
}

interface Harness {
  callTool: (name: string, input: unknown) => Promise<OttoToolResult>;
  brokerCalls: BrowserToolsExecuteInput[];
  bindings: Array<{ serverId: string; browserId: string }>;
}

function createHarness(options: {
  boundBrowserId?: string | null;
  respond: (input: BrowserToolsExecuteInput) => BrowserToolsResponsePayload;
}): Harness {
  const handlers = new Map<string, (input: unknown) => Promise<OttoToolResult>>();
  const brokerCalls: BrowserToolsExecuteInput[] = [];
  const bindings: Array<{ serverId: string; browserId: string }> = [];
  let bound = options.boundBrowserId ?? null;

  const manager: PreviewDevServerHost = {
    start: async () => ({
      server: summary({ boundBrowserId: bound }),
      reused: bound !== null,
      logTail: ["listening on 8202"],
    }),
    stop: async () => summary({ status: "exited" }),
    list: () => [summary({ boundBrowserId: bound })],
    logs: () => ["listening on 8202"],
    bindTab: (serverId, browserId) => {
      bindings.push({ serverId, browserId });
      bound = browserId;
    },
    boundTab: () => bound,
  };

  registerPreviewTools({
    registerTool: (name, _config, handler) => {
      handlers.set(name, handler);
    },
    manager,
    broker: {
      execute: async (input) => {
        brokerCalls.push(input);
        return options.respond(input);
      },
    },
    resolveCallerAgent: () => ({ id: "agent-1", cwd: "C:\\work\\project", workspaceId: "wks_1" }),
  });

  return {
    callTool: async (name, input) => {
      const handler = handlers.get(name);
      if (!handler) {
        throw new Error(`Tool ${name} was not registered`);
      }
      return handler(input);
    },
    brokerCalls,
    bindings,
  };
}

function structuredResult(result: OttoToolResult): Record<string, unknown> {
  const structured = result.structuredContent as { ok: boolean; result?: unknown };
  expect(structured.ok).toBe(true);
  return structured.result as Record<string, unknown>;
}

describe("preview_start tab binding", () => {
  test("opens the designated Otto tab at the server URL and binds it", async () => {
    const harness = createHarness({
      respond: (input) =>
        input.command.command === "new_tab" ? newTabPayload(TAB_A) : listTabsPayload([]),
    });

    const result = await harness.callTool("preview_start", { name: "sample" });

    const payload = structuredResult(result);
    expect(payload.browser).toMatchObject({ browserId: TAB_A, tabUrl: SERVER_URL });
    expect(harness.bindings).toEqual([{ serverId: "srv_test", browserId: TAB_A }]);

    const newTabCall = harness.brokerCalls.find((call) => call.command.command === "new_tab");
    expect(newTabCall?.command).toEqual({
      command: "new_tab",
      args: {
        url: SERVER_URL,
        layout: "split-right",
        preview: { serverId: "srv_test", serverName: "sample", cwd: "C:\\work\\project" },
      },
    });
    expect(newTabCall?.workspaceId).toBe("wks_1");
  });

  test("re-finds the live bound tab and warns when it was navigated away", async () => {
    const harness = createHarness({
      boundBrowserId: TAB_A,
      respond: (input) =>
        input.command.command === "list_tabs"
          ? listTabsPayload([{ browserId: TAB_A, url: "http://example.com/somewhere" }])
          : newTabPayload(TAB_B),
    });

    const result = await harness.callTool("preview_start", { name: "sample" });

    const payload = structuredResult(result);
    const browser = payload.browser as { browserId: string; note?: string };
    expect(browser.browserId).toBe(TAB_A);
    expect(browser.note).toContain("currently at http://example.com/somewhere");
    // No new tab was opened — the designated tab stays "it".
    expect(harness.brokerCalls.map((call) => call.command.command)).toEqual(["list_tabs"]);
    expect(harness.bindings).toEqual([]);
  });

  test("reopens the designated tab when the user closed it", async () => {
    const harness = createHarness({
      boundBrowserId: TAB_A,
      respond: (input) =>
        input.command.command === "list_tabs" ? listTabsPayload([]) : newTabPayload(TAB_B),
    });

    const result = await harness.callTool("preview_start", { name: "sample" });

    const payload = structuredResult(result);
    const browser = payload.browser as { browserId: string; note?: string };
    expect(browser.browserId).toBe(TAB_B);
    expect(browser.note).toContain("previous preview tab was closed");
    expect(harness.bindings).toEqual([{ serverId: "srv_test", browserId: TAB_B }]);
  });

  test("still reports server success when no Otto browser host is connected", async () => {
    const harness = createHarness({ respond: () => noHostPayload() });

    const result = await harness.callTool("preview_start", { name: "sample" });

    const payload = structuredResult(result);
    expect(payload.serverId).toBe("srv_test");
    const browser = payload.browser as { browserId: string | null; note?: string };
    expect(browser.browserId).toBeNull();
    expect(browser.note).toContain("no preview tab could be opened");
    expect(browser.note).toContain("browser_no_host");
  });
});
