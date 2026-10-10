import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionInboundMessage, SessionOutboundMessage } from "@otto-code/protocol/messages";
import { mountBrowserAutomationHandler } from "./handler";
import type { DesktopHostBridge } from "@/desktop/host";
import { RESIDENT_BROWSER_BACKGROUND_AFTER_IDLE_MS } from "../resident-activity";
import {
  clearResidentBrowserWebviewsForTests,
  ensureResidentBrowserWebview,
  isResidentBrowserBackgrounded,
} from "../resident-webviews";

type Request = Extract<SessionOutboundMessage, { type: "browser.automation.execute.request" }>;
type Payload = Extract<
  SessionInboundMessage,
  { type: "browser.automation.execute.response" }
>["payload"];

const cleanups: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  clearResidentBrowserWebviewsForTests();
  vi.useRealTimers();
});

function setup() {
  const browserId = crypto.randomUUID();
  const webview = ensureResidentBrowserWebview({
    browserId,
    workspaceId: "workspace",
    url: "https://example.com",
    profileHost: {
      profilePartition: "persist:otto-browser",
      registerAttachedBrowser: async () => {},
    },
  })!;
  const surface = webview.parentElement!;
  const executed: Array<{ command: string; surfaceVisibility: string }> = [];
  let finishCommand: (() => void) | null = null;
  const host: DesktopHostBridge = {
    browser: {
      executeAutomationCommand: (request) => {
        executed.push({
          command: request.command.command,
          surfaceVisibility: surface.style.visibility,
        });
        return new Promise<Payload>((resolve) => {
          finishCommand = () =>
            resolve({
              requestId: request.requestId,
              ok: true,
              result: {
                command: "snapshot",
                browserId,
                url: "https://example.com",
                title: "Example",
                format: "aria-yaml",
                snapshot: "- document",
              },
            } as Payload);
        });
      },
    },
  };
  let receive: ((request: Request) => void) | undefined;
  const responses: Payload[] = [];
  const unmount = mountBrowserAutomationHandler({
    getHost: () => host,
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
  cleanups.push(unmount);
  return {
    browserId,
    surface,
    executed,
    responses,
    finishCommand: () => finishCommand?.(),
    send: (command: Request["command"]) =>
      receive!({
        type: "browser.automation.execute.request",
        requestId: crypto.randomUUID(),
        agentId: "agent",
        cwd: "/repo",
        workspaceId: "workspace",
        command,
      }),
  };
}

it("wakes a backgrounded parked tab before main executes an AI command against it", async () => {
  const test = setup();
  vi.advanceTimersByTime(RESIDENT_BROWSER_BACKGROUND_AFTER_IDLE_MS);
  expect(isResidentBrowserBackgrounded(test.browserId)).toBe(true);
  expect(test.surface.style.visibility).toBe("hidden");

  test.send({ command: "snapshot", args: { browserId: test.browserId } });
  await vi.waitFor(() => expect(test.executed).toHaveLength(1));
  expect(test.executed[0]).toEqual({ command: "snapshot", surfaceVisibility: "visible" });

  // Still running: the tab stays awake past the grace.
  vi.advanceTimersByTime(RESIDENT_BROWSER_BACKGROUND_AFTER_IDLE_MS * 2);
  expect(test.surface.style.visibility).toBe("visible");

  test.finishCommand();
  await vi.waitFor(() => expect(test.responses).toHaveLength(1));
  expect(test.responses[0]).toMatchObject({ ok: true, result: { command: "snapshot" } });

  vi.advanceTimersByTime(RESIDENT_BROWSER_BACKGROUND_AFTER_IDLE_MS);
  expect(test.surface.style.visibility).toBe("hidden");
});

it("does not wake tabs for commands that target no browser", async () => {
  const test = setup();
  vi.advanceTimersByTime(RESIDENT_BROWSER_BACKGROUND_AFTER_IDLE_MS);
  test.send({ command: "list_tabs", args: {} });
  await vi.waitFor(() => expect(test.executed).toHaveLength(1));
  expect(test.executed[0]).toEqual({ command: "list_tabs", surfaceVisibility: "hidden" });
});
