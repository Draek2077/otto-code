import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { describe, expect, test } from "vitest";
import type {
  CredentialVault,
  CredentialVaultKey,
} from "../integration-authorization/credential-vault.js";
import { FileBackedIntegrationAuthorizationRegistry } from "../integration-authorization/integration-authorization-registry.js";
import { IntegrationAuthorizationService } from "../integration-authorization/integration-authorization-service.js";
import {
  createZoomTeamChatAccessTokenSupplier,
  ZoomTeamChatReauthenticationRequiredError,
} from "./zoom-team-chat-token-supplier.js";

class MemoryCredentialVault implements CredentialVault {
  private readonly values = new Map<string, string>();

  async getAvailability() {
    return { status: "available" as const, backend: "test" };
  }

  async get(key: CredentialVaultKey): Promise<string | null> {
    return this.values.get(JSON.stringify(key)) ?? null;
  }

  async put(key: CredentialVaultKey, value: string): Promise<void> {
    this.values.set(JSON.stringify(key), value);
  }

  async delete(key: CredentialVaultKey): Promise<boolean> {
    return this.values.delete(JSON.stringify(key));
  }
}

describe("Zoom Team Chat access token supplier", () => {
  test("reads a valid non-expiring token only from the daemon vault", async () => {
    const directory = await mkdtemp(join(tmpdir(), "otto-zoom-token-supplier-"));
    try {
      const authorization = new IntegrationAuthorizationService({
        hostId: "host",
        vault: new MemoryCredentialVault(),
        registry: new FileBackedIntegrationAuthorizationRegistry(
          join(directory, "integration-authorizations.json"),
          pino({ enabled: false }),
        ),
      });
      await authorization.initialize();
      await authorization.saveOAuthTokenSet({
        integrationId: "zoom-team-chat",
        connectionId: "primary",
        method: "oauth-pkce",
        tokens: {
          accessToken: "vault-only-access-token",
          refreshToken: "vault-only-refresh-token",
          expiresAt: "2026-08-13T13:00:00.000Z",
          grantedScopes: [],
        },
      });

      await expect(
        createZoomTeamChatAccessTokenSupplier(
          authorization,
          () => new Date("2026-08-13T12:00:00.000Z"),
        )(),
      ).resolves.toBe("vault-only-access-token");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("refreshes an expiring token inside the daemon vault", async () => {
    const directory = await mkdtemp(join(tmpdir(), "otto-zoom-expired-token-"));
    try {
      const authorization = new IntegrationAuthorizationService({
        hostId: "host",
        vault: new MemoryCredentialVault(),
        registry: new FileBackedIntegrationAuthorizationRegistry(
          join(directory, "integration-authorizations.json"),
          pino({ enabled: false }),
        ),
      });
      await authorization.initialize();
      await authorization.saveOAuthTokenSet({
        integrationId: "zoom-team-chat",
        connectionId: "primary",
        method: "oauth-pkce",
        tokens: {
          accessToken: "expired-access-token",
          refreshToken: "refresh-token",
          expiresAt: "2026-08-13T12:00:30.000Z",
          grantedScopes: [],
        },
      });

      await expect(
        createZoomTeamChatAccessTokenSupplier(
          authorization,
          () => new Date("2026-08-13T12:00:00.000Z"),
          async () => ({
            accessToken: "refreshed-access-token",
            refreshToken: "refreshed-refresh-token",
            expiresAt: "2026-08-13T13:00:00.000Z",
            grantedScopes: ["team_chat:read:list_user_channels"],
          }),
        )(),
      ).resolves.toBe("refreshed-access-token");
      await expect(
        authorization.readOAuthTokenSet({
          integrationId: "zoom-team-chat",
          connectionId: "primary",
        }),
      ).resolves.toMatchObject({
        accessToken: "refreshed-access-token",
        refreshToken: "refreshed-refresh-token",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("marks the connection for reauthentication when refresh fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "otto-zoom-refresh-failure-"));
    try {
      const authorization = new IntegrationAuthorizationService({
        hostId: "host",
        vault: new MemoryCredentialVault(),
        registry: new FileBackedIntegrationAuthorizationRegistry(
          join(directory, "integration-authorizations.json"),
          pino({ enabled: false }),
        ),
      });
      await authorization.initialize();
      await authorization.saveOAuthTokenSet({
        integrationId: "zoom-team-chat",
        connectionId: "primary",
        method: "oauth-pkce",
        tokens: {
          accessToken: "expired-access-token",
          refreshToken: "refresh-token",
          expiresAt: "2026-08-13T12:00:30.000Z",
          grantedScopes: [],
        },
      });

      await expect(
        createZoomTeamChatAccessTokenSupplier(
          authorization,
          () => new Date("2026-08-13T12:00:00.000Z"),
          async () => {
            throw new Error("refresh failed");
          },
        )(),
      ).rejects.toBeInstanceOf(ZoomTeamChatReauthenticationRequiredError);
      await expect(
        authorization.getConnection({ integrationId: "zoom-team-chat", connectionId: "primary" }),
      ).resolves.toMatchObject({ state: "reauth_required", errorCode: "token_refresh_failed" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
