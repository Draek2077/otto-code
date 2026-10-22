import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { RpcInput } from "@getpaseo/plugin";
import { credentialSave, credentialStatus } from "../shared/credentials.js";
import type { ConnectionSettings } from "../shared/settings.js";
import { endpointProfiles } from "./endpoints.js";
import type { HostCredentials } from "./credentials.js";
import { endpoint } from "./http.js";

interface CredentialServices {
  server: PluginServerContext;
  credentials?: HostCredentials;
  readSettings(): Promise<{ revision: string; values: ConnectionSettings }>;
}

export function registerHostCredentials({
  server,
  credentials,
  readSettings,
}: CredentialServices): void {
  async function profileFor(input: RpcInput<typeof credentialStatus>) {
    if (!credentials) throw new Error("Host credential storage is unavailable on this daemon.");
    const settings = await readSettings();
    if (settings.revision !== input.settingsRevision)
      throw new Error("Host connection settings changed. Reload them before managing this key.");
    const profile = endpointProfiles(settings.values, true).find(
      (item) => item.id === input.profileId,
    );
    if (
      !profile ||
      endpoint(profile.settings.baseUrl, "chat/completions") !==
        endpoint(input.baseUrl, "chat/completions")
    )
      throw new Error("This endpoint changed. Reload the host connection settings first.");
    return profile;
  }
  async function status(input: RpcInput<typeof credentialStatus>) {
    const profile = await profileFor(input);
    const saved = await credentials!.status(input.profileId, profile.settings.baseUrl);
    let source: "managed" | "environment" | "legacy" | "none" = "none";
    if (saved.configured) source = "managed";
    else if (!saved.endpointChanged && process.env[profile.settings.apiKeyEnv])
      source = "environment";
    return { ...saved, source };
  }
  server.handle(credentialStatus, status);
  server.handle(credentialSave, async (input) => {
    await profileFor(input);
    await credentials!.save(input);
    return status(input);
  });
}
