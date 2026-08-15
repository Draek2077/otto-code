import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { describe, expect, test } from "vitest";
import {
  CredentialVaultUnavailableError,
  UnavailableCredentialVault,
  type CredentialVault,
  type CredentialVaultKey,
} from "./credential-vault.js";
import { FileBackedIntegrationAuthorizationRegistry } from "./integration-authorization-registry.js";
import {
  IntegrationAuthorizationMethodChangeRequiresDisconnectError,
  IntegrationAuthorizationService,
} from "./integration-authorization-service.js";

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

function createService(filePath: string, vault: CredentialVault): IntegrationAuthorizationService {
  return new IntegrationAuthorizationService({
    hostId: "host",
    vault,
    registry: new FileBackedIntegrationAuthorizationRegistry(filePath, pino({ enabled: false })),
    now: () => new Date("2026-08-13T12:00:00.000Z"),
  });
}

describe("IntegrationAuthorizationService", () => {
  test("persists safe metadata separately from a vault secret", async () => {
    const directory = await mkdtemp(join(tmpdir(), "otto-integration-auth-"));
    try {
      const filePath = join(directory, "integration-authorizations.json");
      const service = createService(filePath, new MemoryCredentialVault());
      await service.initialize();
      await service.saveConnectionMetadata({
        integrationId: "zoom-team-chat",
        connectionId: "primary",
        method: "oauth-pkce",
        state: "connected",
        accountLabel: "otto@example.test",
        grantedScopes: ["team_chat:read:list_user_messages"],
      });
      await service.saveSecret({
        integrationId: "zoom-team-chat",
        connectionId: "primary",
        value: "refresh-token",
      });

      await expect(
        service.getConnection({ integrationId: "zoom-team-chat", connectionId: "primary" }),
      ).resolves.toMatchObject({ accountLabel: "otto@example.test", state: "connected" });
      await expect(
        service.readSecret({ integrationId: "zoom-team-chat", connectionId: "primary" }),
      ).resolves.toBe("refresh-token");

      const persisted = await readFile(filePath, "utf8");
      expect(persisted).not.toContain("refresh-token");
      expect(persisted).toContain("otto@example.test");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("fails closed when the host has no credential vault", async () => {
    const service = createService(
      join(tmpdir(), `otto-integration-auth-unavailable-${Date.now()}.json`),
      new UnavailableCredentialVault("test vault unavailable"),
    );

    await expect(
      service.saveSecret({
        integrationId: "zoom-team-chat",
        connectionId: "primary",
        value: "secret",
      }),
    ).rejects.toBeInstanceOf(CredentialVaultUnavailableError);
  });

  test("projects vault readiness and connection metadata without secrets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "otto-integration-auth-overview-"));
    try {
      const service = createService(
        join(directory, "integration-authorizations.json"),
        new MemoryCredentialVault(),
      );
      await service.initialize();
      await service.saveConnectionMetadata({
        integrationId: "zoom-team-chat",
        connectionId: "primary",
        method: "oauth-pkce",
        state: "connected",
      });
      await service.saveSecret({
        integrationId: "zoom-team-chat",
        connectionId: "primary",
        value: "refresh-token",
      });

      await expect(service.getOverview()).resolves.toEqual({
        vault: { status: "available", backend: "test" },
        connections: [
          {
            integrationId: "zoom-team-chat",
            connectionId: "primary",
            method: "oauth-pkce",
            state: "connected",
            accountLabel: null,
            grantedScopes: [],
            updatedAt: "2026-08-13T12:00:00.000Z",
            errorCode: null,
          },
        ],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("stores OAuth token sets in the vault while projecting only safe metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "otto-integration-oauth-tokens-"));
    try {
      const filePath = join(directory, "integration-authorizations.json");
      const service = createService(filePath, new MemoryCredentialVault());
      await service.initialize();
      await service.saveOAuthTokenSet({
        integrationId: "zoom-team-chat",
        connectionId: "primary",
        method: "oauth-pkce",
        accountLabel: "otto@example.test",
        tokens: {
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresAt: "2026-08-13T13:00:00.000Z",
          grantedScopes: ["team_chat:read:list_user_messages"],
        },
      });

      await expect(
        service.readOAuthTokenSet({ integrationId: "zoom-team-chat", connectionId: "primary" }),
      ).resolves.toEqual({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresAt: "2026-08-13T13:00:00.000Z",
        grantedScopes: ["team_chat:read:list_user_messages"],
      });
      await expect(
        service.getConnection({ integrationId: "zoom-team-chat", connectionId: "primary" }),
      ).resolves.toMatchObject({
        state: "connected",
        accountLabel: "otto@example.test",
        grantedScopes: ["team_chat:read:list_user_messages"],
      });
      const persisted = await readFile(filePath, "utf8");
      expect(persisted).not.toContain("access-token");
      expect(persisted).not.toContain("refresh-token");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("requires an explicit disconnect before changing a connected sign-in method", async () => {
    const directory = await mkdtemp(join(tmpdir(), "otto-integration-method-choice-"));
    try {
      const service = createService(
        join(directory, "integration-authorizations.json"),
        new MemoryCredentialVault(),
      );
      await service.initialize();
      await service.saveConnectionMetadata({
        integrationId: "zoom-team-chat",
        connectionId: "primary",
        method: "oauth-pkce",
        state: "connected",
      });

      await expect(
        service.selectConnectionMethod({
          integrationId: "zoom-team-chat",
          connectionId: "primary",
          method: "api-key",
        }),
      ).rejects.toBeInstanceOf(IntegrationAuthorizationMethodChangeRequiresDisconnectError);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("persists Otto availability without touching the vault credential", async () => {
    const directory = await mkdtemp(join(tmpdir(), "otto-integration-availability-"));
    try {
      const service = createService(
        join(directory, "integration-authorizations.json"),
        new MemoryCredentialVault(),
      );
      await service.initialize();
      await service.saveOAuthTokenSet({
        integrationId: "zoom-team-chat",
        connectionId: "primary",
        method: "oauth-pkce",
        tokens: {
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresAt: "2026-08-13T13:00:00.000Z",
          grantedScopes: [],
        },
      });

      await expect(
        service.setConnectionEnabled({
          integrationId: "zoom-team-chat",
          connectionId: "primary",
          enabled: false,
        }),
      ).resolves.toMatchObject({ enabled: false, state: "connected" });
      await expect(
        service.readOAuthTokenSet({ integrationId: "zoom-team-chat", connectionId: "primary" }),
      ).resolves.toMatchObject({ accessToken: "access-token", refreshToken: "refresh-token" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
