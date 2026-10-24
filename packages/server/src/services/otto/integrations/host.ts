import path from "node:path";
import { readFile } from "node:fs/promises";
import { createDaemonCredentialVault, type CredentialVault } from "./credential-vault.js";
import { FileIntegrationRegistry } from "./registry.js";
import { IntegrationAccountRpc } from "./rpc.js";
import { AtlassianAccountService } from "../atlassian/account.js";

/** Inert daemon composition, shared by Jira and future Atlassian consumers. */
export function createHostIntegrations(home: string, hostId: string) {
  let vault: Promise<CredentialVault> | null = null;
  const atlassian = new AtlassianAccountService({
    hostId,
    registry: new FileIntegrationRegistry(path.join(home, "integrations", "accounts.json")),
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
  return { atlassian, rpc: new IntegrationAccountRpc(hostId, atlassian) };
}
