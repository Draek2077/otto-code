import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { BrowserToolsBroker } from "../../browser-tools/broker.js";
import type {
  BrowserAutomationExecuteRequest,
  BrowserAutomationResult,
} from "@getpaseo/protocol/browser-automation/rpc-schemas";
import { BrowserAdmissions, type PreviewNavigationTarget } from "./admission.js";
function fixture(count = 0) {
  const tabs = Array.from({ length: count }, () => ({
    browserId: randomUUID(),
    workspaceId: "workspace",
    url: "https://fixture.test",
    title: "Fixture",
    isActive: false,
    isLoading: false,
  }));
  let target: PreviewNavigationTarget | null = null,
    failList = false;
  const lookup = vi.fn(
    async (_host: string): Promise<{ address: string }[]> => [{ address: "127.0.0.1" }],
  );
  const admission = new BrowserAdmissions({ lookup, previewTarget: async () => target });
  const broker = new BrowserToolsBroker({
    ottoAdmission: (input, next) => admission.execute(input, next),
  });
  const received: BrowserAutomationExecuteRequest[] = [];
  broker.registerClient({
    id: "fixture-host",
    hostKind: "fixture",
    supportedCommands: ["new_tab", "list_tabs", "navigate"],
    sendBrowserAutomationRequest(request) {
      received.push(request);
      if (request.command.command === "list_tabs" && failList) {
        broker.receiveResponse({
          type: "browser.automation.execute.response",
          payload: {
            requestId: request.requestId,
            ok: false,
            error: { code: "browser_no_host", message: "Fixture unavailable", retryable: false },
          },
        });
        return;
      }
      let result: BrowserAutomationResult;
      switch (request.command.command) {
        case "list_tabs":
          result = { command: "list_tabs", tabs };
          break;
        case "new_tab": {
          const tab = {
            browserId: randomUUID(),
            workspaceId: request.workspaceId ?? "workspace",
            url: request.command.args.url ?? "about:blank",
            title: "Fixture",
            isActive: false,
            isLoading: false,
          };
          tabs.push(tab);
          result = { command: "new_tab", ...tab };
          break;
        }
        case "navigate":
          result = {
            command: "navigate",
            browserId: request.command.args.browserId,
            url: request.command.args.url,
          };
          break;
        default:
          throw new Error("Unexpected fixture command");
      }
      broker.receiveResponse({
        type: "browser.automation.execute.response",
        payload: { requestId: request.requestId, ok: true, result },
      });
    },
  });
  const create = (url = "https://fixture.test") =>
    broker.execute({
      agentId: "agent",
      workspaceId: "workspace",
      cwd: "/fixture",
      command: { command: "new_tab", args: { url } },
    });
  return {
    broker,
    create,
    tabs,
    received,
    lookup,
    setTarget(value: PreviewNavigationTarget | null) {
      target = value;
    },
    failList() {
      failList = true;
    },
  };
}
test("parallel browser and Preview creates cannot race past the shared workspace tab cap", async () => {
  const f = fixture(11);
  const results = await Promise.all([
    f.create(),
    f.broker.execute({
      agentId: "agent",
      workspaceId: "workspace",
      cwd: "/fixture",
      ottoPreviewServerId: "preview",
      command: { command: "new_tab", args: { url: "http://127.0.0.1:8200" } },
    }),
  ]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toHaveLength(1);
  expect(f.tabs).toHaveLength(12);
  expect(f.received.filter((request) => request.command.command === "new_tab")).toHaveLength(1);
});
test("a failed host inventory never authorizes another create", async () => {
  const f = fixture();
  f.failList();
  expect(await f.create()).toMatchObject({ ok: false, error: { code: "browser_denied" } });
  expect(f.received.filter((request) => request.command.command === "new_tab")).toEqual([]);
});
test("Preview URLs cannot be opened or navigated in a different tab", async () => {
  const f = fixture(1),
    id = f.tabs[0].browserId;
  f.setTarget({ serverId: "preview", browserId: id });
  expect(await f.create()).toMatchObject({ ok: false });
  expect(
    await f.broker.execute({
      workspaceId: "workspace",
      command: {
        command: "navigate",
        args: { browserId: randomUUID(), url: "https://fixture.test" },
      },
    }),
  ).toMatchObject({ ok: false });
  expect(
    await f.broker.execute({
      workspaceId: "workspace",
      command: { command: "navigate", args: { browserId: id, url: "https://fixture.test" } },
    }),
  ).toMatchObject({ ok: true });
});
test("only the owning Preview service can create its unbound designated tab; its authority is not wire data", async () => {
  const f = fixture();
  f.setTarget({ serverId: "preview", browserId: null });
  expect(await f.create()).toMatchObject({ ok: false });
  const result = await f.broker.execute({
    workspaceId: "workspace",
    cwd: "/fixture",
    ottoPreviewServerId: "preview",
    command: { command: "new_tab", args: { url: "https://fixture.test" } },
  });
  expect(result).toMatchObject({ ok: true });
  expect(f.received.at(-1)).not.toHaveProperty("ottoPreviewServerId");
});
test.each([
  "http://169.254.169.254/latest",
  "http://169.254.170.2/credentials",
  "http://100.100.100.200/latest",
  "http://[fd00:ec2::254]/",
  "http://[::ffff:169.254.169.254]/",
  "http://metadata.google.internal/",
  "http://instance-data.ec2.internal/",
  "https://user:secret@fixture.test/",
])("refuses metadata/credential navigation before host dispatch: %s", async (url) => {
  const f = fixture();
  expect(await f.create(url)).toMatchObject({ ok: false, error: { code: "browser_denied" } });
  expect(f.received).toEqual([]);
});
test("DNS aliases and mixed answers cannot conceal metadata; resolver failures stay fail-closed", async () => {
  const f = fixture();
  f.lookup.mockResolvedValueOnce([{ address: "127.0.0.1" }, { address: "169.254.169.254" }]);
  expect(await f.create()).toMatchObject({ ok: false });
  f.lookup.mockRejectedValueOnce(new Error("private resolver detail"));
  expect(await f.create()).toMatchObject({ ok: false });
  expect(f.received).toEqual([]);
});
test.each(["http://127.0.0.1:8200", "http://[::1]:8200", "https://fixture.test"])(
  "ordinary and loopback development URLs keep the existing broker ownership: %s",
  async (url) => {
    const f = fixture();
    expect(await f.create(url)).toMatchObject({ ok: true });
    expect(f.tabs).toHaveLength(1);
  },
);
