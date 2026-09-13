import { afterEach, expect, it } from "vitest";
import type { SessionInboundMessage, SessionOutboundMessage } from "@otto-code/protocol/messages";
import { mountBrowserAutomationHandler } from "./handler";
import { createWorkspaceBrowser } from "../store";
import { findPaneById, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

type Request = Extract<SessionOutboundMessage, { type: "browser.automation.execute.request" }>;
type Response = Extract<SessionInboundMessage, { type: "browser.automation.execute.response" }>;
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function setup() {
  const workspaceId = crypto.randomUUID();
  const serverId = "focus-test";
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId })!;
  const store = useWorkspaceLayoutStore.getState();
  const draftTabId = store.openTabFocused(workspaceKey, { kind: "draft", draftId: workspaceId });
  const { browserId } = createWorkspaceBrowser({ initialUrl: "https://example.com" });
  store.openTabInBackground(workspaceKey, { kind: "browser", browserId });
  const editor = document.createElement("textarea");
  editor.value = "unfinished draft";
  document.body.appendChild(editor);
  editor.focus();
  editor.setSelectionRange(3, 7);
  let receive: ((request: Request) => void) | undefined;
  const responses: Response["payload"][] = [];
  const unmount = mountBrowserAutomationHandler({
    serverId,
    getHost: () => null,
    client: {
      on: (_type, callback) => {
        receive = callback;
        return () => {
          receive = undefined;
        };
      },
      sendBrowserAutomationExecuteResponse: (response) => responses.push(response.payload),
    },
  });
  cleanups.push(() => {
    unmount();
    editor.remove();
  });
  return {
    editor,
    browserId,
    draftTabId,
    responses,
    focusedTab: () => {
      const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey]!;
      return findPaneById(layout.root, layout.focusedPaneId)?.focusedTabId;
    },
    send: (command: Request["command"]) =>
      receive!({
        type: "browser.automation.execute.request",
        requestId: "focus-test",
        agentId: "agent",
        cwd: "/repo",
        workspaceId,
        command,
      }),
  };
}

it("rejects an agent tab-focus request while preserving the user's editor and selection", () => {
  const test = setup();
  test.send({ command: "focus_tab", args: { browserId: test.browserId } });
  expect(test.responses[0]).toMatchObject({ ok: false, error: { code: "browser_unsupported" } });
  expect(test.focusedTab()).toBe(test.draftTabId);
  expect(document.activeElement).toBe(test.editor);
  expect([test.editor.selectionStart, test.editor.selectionEnd]).toEqual([3, 7]);
  expect(test.editor.value).toBe("unfinished draft");
});

it("opens a split browser without changing the active draft or editor", async () => {
  const test = setup();
  test.send({ command: "new_tab", args: { url: "https://example.com", layout: "split-right" } });
  await expect.poll(() => test.responses.length).toBe(1);
  expect(test.responses[0]).toMatchObject({ ok: true, result: { command: "new_tab" } });
  expect(test.focusedTab()).toBe(test.draftTabId);
  expect(document.activeElement).toBe(test.editor);
  expect([test.editor.selectionStart, test.editor.selectionEnd]).toEqual([3, 7]);
});
