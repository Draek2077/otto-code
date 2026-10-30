import path from "node:path";
import { readFile } from "node:fs/promises";
import { createDaemonCredentialVault, type CredentialVault } from "./credential-vault.js";
import { FileIntegrationRegistry } from "./registry.js";
import { IntegrationAuthorizationSecrets } from "./authorization-secrets.js";
import { IntegrationAccountRpc } from "./rpc.js";
import { AtlassianAccountService } from "../atlassian/account.js";
import { BitbucketConnectionsStore, BitbucketConnectionError } from "../bitbucket/connections.js";
import { BitbucketConnectionsRpc } from "../bitbucket/rpc.js";
import { createBitbucketService } from "../bitbucket/service.js";
import { saveAtlassianAccount } from "@getpaseo/plugin/otto/atlassian-settings";
import type { ConnectorsSnapshot } from "@getpaseo/plugin/otto/connectors";
import { ConnectorHost } from "../connectors/host.js";
import { legacyIntegrationAccount } from "./legacy-authorization.js";

/** Inert daemon composition, shared by Jira and future Atlassian consumers. */
export function createHostIntegrations(
  home: string,
  hostId: string,
  projects?: {
    exists: (id: string) => Promise<boolean>;
    forCwd: (cwd: string) => Promise<string | undefined>;
  },
  connectorProviders: () => ConnectorsSnapshot["providers"] = () => [],
) {
  let vault: Promise<CredentialVault> | null = null;
  const registry = new FileIntegrationRegistry(path.join(home, "integrations", "accounts.json"));
  // Token refresh has its own revision domain. It must not invalidate an open
  // Jira/Bitbucket settings draft or publish OAuth material into user config.
  const authorization = new IntegrationAuthorizationSecrets({
    hostId,
    registry: new FileIntegrationRegistry(path.join(home, "integrations", "authorization.json")),
    vault: () => (vault ??= createDaemonCredentialVault()),
  });
  const connectors = new ConnectorHost({
    hostId,
    cwd: home,
    registry: new FileIntegrationRegistry(path.join(home, "integrations", "connectors.json")),
    authorization,
    providers: connectorProviders,
    legacy: async () => {
      try {
        return await readFile(path.join(home, "otto-config.json"), "utf8");
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
          return null;
        throw new Error("Preserved connector settings could not be read.", { cause: error });
      }
    },
    legacyCredential: async (integrationId, connectionId) =>
      (vault ??= createDaemonCredentialVault()).then((value) =>
        value.get({ hostId, integrationId, connectionId }),
      ),
    legacyAccount: (integrationId, connectionId) =>
      legacyIntegrationAccount(home, integrationId, connectionId),
  });
  const atlassian = new AtlassianAccountService({
    hostId,
    registry,
    vault: () => (vault ??= createDaemonCredentialVault()),
    legacy: async () => {
      try {
        return JSON.parse(await readFile(path.join(home, "otto-config.json"), "utf8")) as unknown;
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
          return {};
        throw new Error("Preserved host integration settings could not be read.", { cause: error });
      }
    },
  });
  const connections = new BitbucketConnectionsStore({
    hostId,
    registry,
    vault: () => (vault ??= createDaemonCredentialVault()),
    shared: () => atlassian.resolve(),
    projectExists: (id) => projects?.exists(id) ?? Promise.resolve(false),
    legacy: async () => {
      try {
        return await readFile(path.join(home, "forge-connections.json"), "utf8");
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
          return null;
        throw error;
      }
    },
  });
  const bitbucket = createBitbucketService({
    credential: async (cwd) => connections.resolve(await projects?.forCwd(cwd)),
  });
  connections.subscribe(() => bitbucket.invalidate({ cwd: "" }));
  const accounts = new IntegrationAccountRpc(hostId, atlassian);
  const bitbucketRpc = new BitbucketConnectionsRpc(
    hostId,
    connections,
    undefined,
    async (input) => {
      const projectId = await projects?.forCwd(input.cwd);
      if (!projectId) throw new Error("Choose a registered project checkout.");
      const credential = await connections.resolve(projectId);
      const snapshot = await connections.read(projectId);
      if (snapshot.revision !== input.expectedRevision)
        throw new BitbucketConnectionError(
          "conflict",
          "The selected Bitbucket account changed. Reload before updating the discussion.",
        );
      // Capture the admitted account. A later account switch cannot redirect an
      // already confirmed command into a different credential identity.
      const command = createBitbucketService({ credential: async () => credential });
      try {
        await command.setThreadResolved(input);
      } finally {
        command.dispose?.();
        bitbucket.invalidate({ cwd: input.cwd });
      }
    },
  );
  return {
    authorization,
    connectors,
    atlassian,
    connections,
    bitbucket,
    async close() {
      bitbucket.dispose?.();
      await connectors.close();
    },
    rpc: {
      invoke(method: string, input: unknown) {
        const connector = connectors.invoke(method, input);
        if (connector) return connector;
        const owned = bitbucketRpc.invoke(method, input);
        if (owned) return owned;
        const shared = accounts.invoke(method, input);
        // A credential publication can succeed even when retirement reports an
        // error. Invalidate both success and uncertain outcomes, without retries.
        if (shared && method === saveAtlassianAccount.name)
          return shared.finally(() => bitbucket.invalidate({ cwd: "" }));
        return shared;
      },
    },
  };
}
