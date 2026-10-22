import type { PluginServerContext } from "@getpaseo/plugin/server";
import { providerSettings } from "./shared/settings.js";
import { createOpenAiProvider } from "./server/provider.js";
import path from "node:path";
import { HostCredentials } from "./server/credentials.js";
import { registerHostCredentials } from "./server/credential-handlers.js";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(providerSettings);
  const home = process.env.OTTO_PROVIDER_HOST_HOME;
  const credentials = home
    ? new HostCredentials(path.join(home, "otto-openai-compatible"))
    : undefined;
  const readSettings = async () => {
    const state = await settings.read();
    if (state.status !== "ready") throw new Error(state.error);
    return state;
  };
  registerHostCredentials({ server, credentials, readSettings });
  server.registerProvider(
    createOpenAiProvider(async () => (await readSettings()).values, {
      imageDirectory: home ? path.join(home, "otto-openai-compatible", "images") : undefined,
      resolveApiKey: credentials
        ? (profile) => credentials.key(profile.id, profile.settings.baseUrl)
        : undefined,
    }),
  );
  return () => {};
}
