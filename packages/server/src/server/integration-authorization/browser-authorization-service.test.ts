import { describe, expect, test } from "vitest";
import {
  BrowserAuthorizationDriverUnavailableError,
  IntegrationBrowserAuthorizationService,
} from "./browser-authorization-service.js";

describe("IntegrationBrowserAuthorizationService", () => {
  test("routes browser sign-in to the matching registered driver", async () => {
    const service = new IntegrationBrowserAuthorizationService();
    service.register({
      integrationId: "zoom-team-chat",
      connectionId: "primary",
      start: async () => ({ authorizationUrl: "https://zoom.us/oauth/authorize?state=opaque" }),
    });

    await expect(
      service.start({ integrationId: "zoom-team-chat", connectionId: "primary" }),
    ).resolves.toEqual({ authorizationUrl: "https://zoom.us/oauth/authorize?state=opaque" });
  });

  test("does not invent a sign-in flow for an unregistered integration", async () => {
    const service = new IntegrationBrowserAuthorizationService();
    await expect(
      service.start({ integrationId: "notion", connectionId: "primary" }),
    ).rejects.toBeInstanceOf(BrowserAuthorizationDriverUnavailableError);
  });

  test("resolves newly installed connections without restarting the host", async () => {
    const service = new IntegrationBrowserAuthorizationService();
    const installed = new Set<string>();
    service.registerResolver("google-connectors", (connectionId) =>
      installed.has(connectionId)
        ? {
            integrationId: "google-connectors",
            connectionId,
            start: async () => ({ authorizationUrl: "https://accounts.google.com/authorize" }),
          }
        : null,
    );
    const key = { integrationId: "google-connectors", connectionId: "gmail" };
    await expect(service.start(key)).rejects.toBeInstanceOf(
      BrowserAuthorizationDriverUnavailableError,
    );
    installed.add("gmail");
    await expect(service.start(key)).resolves.toEqual({
      authorizationUrl: "https://accounts.google.com/authorize",
    });
    installed.delete("gmail");
    await expect(service.start(key)).rejects.toBeInstanceOf(
      BrowserAuthorizationDriverUnavailableError,
    );
  });
});
