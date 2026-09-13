import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@otto-code/client";
import type { ConnectorsOauthStatusMessage } from "@otto-code/protocol/messages";
import { openExternalUrl } from "@/utils/open-external-url";
import { signInOauthConnector } from "./connectors-oauth-sign-in";

vi.mock("@/utils/open-external-url", () => ({ openExternalUrl: vi.fn() }));

function fixture() {
  const listeners = new Set<(message: ConnectorsOauthStatusMessage) => void>();
  const authorize = vi.fn().mockResolvedValue({
    status: "redirect",
    authorizationUrl: "https://example.com/authorize",
    error: null,
  });
  const client = {
    connectorsOauthAuthorize: authorize,
    on: vi.fn((_event: string, listener: (message: ConnectorsOauthStatusMessage) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  } as unknown as DaemonClient;
  const emit = (
    status: "connected" | "failed",
    connectorId = "notion",
    error: string | null = null,
  ) => {
    for (const listener of listeners)
      listener({
        type: "connectors.oauth.status",
        payload: { connectorId, status, account: null, error },
      });
  };
  return { client, authorize, listeners, emit, controller: new AbortController() };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(openExternalUrl).mockReset().mockResolvedValue();
});
afterEach(() => vi.useRealTimers());

describe("connector browser sign-in", () => {
  it("waits for this connector's consent after opening the browser", async () => {
    const f = fixture();
    const waiting = vi.fn();
    const completed = vi.fn();
    const task = signInOauthConnector(f.client, "notion", {
      signal: f.controller.signal,
      scope: "read",
      onWaiting: waiting,
    }).then(completed);
    await vi.advanceTimersByTimeAsync(0);
    expect(waiting).toHaveBeenCalledWith("https://example.com/authorize");
    expect(f.authorize).toHaveBeenCalledWith("notion", "read");
    f.emit("connected", "other");
    expect(completed).not.toHaveBeenCalled();
    f.emit("connected");
    await task;
    expect(completed).toHaveBeenCalledOnce();
    expect(f.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("catches consent completed immediately when the browser opens", async () => {
    const f = fixture();
    vi.mocked(openExternalUrl).mockImplementation(async () => {
      f.emit("connected");
    });
    await signInOauthConnector(f.client, "notion", { signal: f.controller.signal });
    expect(f.listeners.size).toBe(0);
  });

  it("reports browser-opening failures and disposes the status subscription", async () => {
    const f = fixture();
    vi.mocked(openExternalUrl).mockRejectedValue(new Error("Browser unavailable"));
    await expect(
      signInOauthConnector(f.client, "notion", { signal: f.controller.signal }),
    ).rejects.toThrow("Browser unavailable");
    expect(f.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["abort", "timeout", "denied"])("cleans up after %s", async (end) => {
    const f = fixture();
    const task = signInOauthConnector(f.client, "notion", { signal: f.controller.signal });
    const errors = { abort: "cancelled", timeout: "timed out", denied: "Access denied" };
    const rejected = expect(task).rejects.toThrow(errors[end as keyof typeof errors]);
    await vi.advanceTimersByTimeAsync(0);
    if (end === "abort") f.controller.abort();
    else if (end === "timeout") await vi.advanceTimersByTimeAsync(310_000);
    else f.emit("failed", "notion", "Access denied");
    await rejected;
    expect(f.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not open a browser when the daemon already authorized the connector", async () => {
    const f = fixture();
    f.authorize.mockResolvedValue({ status: "authorized" });
    await signInOauthConnector(f.client, "notion", { signal: f.controller.signal });
    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(f.client.on).not.toHaveBeenCalled();
  });

  it("does not open a browser if the panel closed while starting sign-in", async () => {
    const f = fixture();
    f.authorize.mockImplementation(async () => {
      f.controller.abort();
      return { status: "redirect", authorizationUrl: "https://example.com/authorize" };
    });
    await expect(
      signInOauthConnector(f.client, "notion", { signal: f.controller.signal }),
    ).rejects.toThrow();
    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(f.listeners.size).toBe(0);
  });

  it("rejects a redirect without a sign-in URL", async () => {
    const f = fixture();
    f.authorize.mockResolvedValue({ status: "redirect", authorizationUrl: null });
    await expect(
      signInOauthConnector(f.client, "notion", { signal: f.controller.signal }),
    ).rejects.toThrow("Could not start sign-in");
    expect(openExternalUrl).not.toHaveBeenCalled();
  });
});
