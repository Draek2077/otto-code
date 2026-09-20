/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectorConfig } from "@otto-code/protocol/provider-config";
import { OauthConnectorAuth } from "./connectors-oauth-auth";
import { signInOauthConnector } from "./connectors-oauth-sign-in";
import { openExternalUrl } from "@/utils/open-external-url";

const runtime = vi.hoisted(() => ({
  supported: true,
  hostedSupported: true,
  client: { connectorsListTools: vi.fn(), connectorsOauthDisconnect: vi.fn() },
}));
vi.mock("@/runtime/host-runtime", () => ({ useHostRuntimeClient: () => runtime.client }));
vi.mock("./connectors-shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./connectors-shared")>()),
  useConnectorOauthFeature: () => runtime.supported,
  useHostedConnectorFeature: () => runtime.hostedSupported,
}));
vi.mock("./connectors-oauth-sign-in", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./connectors-oauth-sign-in")>()),
  signInOauthConnector: vi.fn(),
}));
vi.mock("@/utils/open-external-url", () => ({ openExternalUrl: vi.fn() }));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress(): void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));

const notion: ConnectorConfig = {
  id: "notion",
  label: "Notion",
  enabled: true,
  server: { type: "http", url: "https://mcp.notion.com/mcp" },
};
function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("Cancelled")), { once: true });
  });
}
function mount(connector = notion) {
  const changed = vi.fn();
  const result = render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <OauthConnectorAuth serverId="host" connector={connector} onChanged={changed} />
    </QueryClientProvider>,
  );
  return { ...result, changed };
}
beforeEach(() => {
  vi.clearAllMocks();
  runtime.supported = true;
  runtime.hostedSupported = true;
  vi.mocked(signInOauthConnector).mockReset().mockResolvedValue();
  vi.mocked(openExternalUrl).mockResolvedValue();
  runtime.client.connectorsListTools.mockResolvedValue({
    tools: [{ name: "search" }],
    error: null,
  });
});
afterEach(cleanup);

describe("installed OAuth connector recovery", () => {
  it("discloses hosted custody and displays connection metadata without token fields", () => {
    mount({
      id: "box",
      label: "Box",
      server: { type: "http", url: "https://mcp.box.com" },
      auth: {
        kind: "oauth",
        account: "user@example.test",
        hosted: { vendorId: "box", connected: true, scopes: ["root_readwrite"] },
      },
    });
    expect(screen.getByText(/handles sign-in through its shared service/)).toBeTruthy();
    expect(screen.getByText(/user@example.test/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  });

  it("blocks hosted sign-in on a host lacking the new capability", () => {
    runtime.hostedSupported = false;
    mount({ id: "box", server: { type: "http", url: "https://mcp.box.com" } });
    expect(screen.getByText(/Hosted sign-in is not enabled/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(signInOauthConnector).not.toHaveBeenCalled();
  });

  it("offers Connect for a saved Notion connector without a completed grant", async () => {
    mount();
    expect(screen.getByText(/Sign-in incomplete/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByText(/Connected. 1 tools available/);
    expect(signInOauthConnector).toHaveBeenCalledWith(
      runtime.client,
      "notion",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(runtime.client.connectorsListTools).toHaveBeenCalledWith("notion");
  });

  it("lets a user reopen consent after reaching the vendor workspace and cancels its wait on unmount", async () => {
    vi.mocked(signInOauthConnector).mockImplementation(async (_client, _id, options) => {
      options.onWaiting?.("https://example.com/authorize");
      await waitForAbort(options.signal);
    });
    const view = mount();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    const reopen = await screen.findByRole("button", { name: "Open sign-in page" });
    expect(screen.getByText(/Waiting for access approval/)).toBeTruthy();
    fireEvent.click(reopen);
    await waitFor(() =>
      expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/authorize"),
    );
    expect(runtime.client.connectorsListTools).not.toHaveBeenCalled();
    const signal = vi.mocked(signInOauthConnector).mock.calls[0][2].signal;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });

  it("keeps failed tool verification actionable without claiming success", async () => {
    runtime.client.connectorsListTools.mockResolvedValue({
      tools: [],
      error: "Missing or invalid access token",
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByText("Missing or invalid access token");
    expect(screen.queryByText(/tools available/)).toBeNull();
    expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("offers reconnect and disconnect when redacted token presence is available", () => {
    mount({ ...notion, auth: { kind: "oauth", tokens: { accessToken: "***" } } });
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  });

  it("keeps OAuth controls gated and leaves non-OAuth connectors alone", () => {
    runtime.supported = false;
    const view = mount();
    expect(screen.queryByRole("button")).toBeNull();
    view.unmount();
    runtime.supported = true;
    mount({ id: "deepwiki", server: { type: "http", url: "https://mcp.deepwiki.com/mcp" } });
    expect(screen.queryByRole("button")).toBeNull();
  });
});
