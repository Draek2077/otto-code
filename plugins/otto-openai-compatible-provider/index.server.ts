import type { PluginServerContext } from "@getpaseo/plugin/server";
import { providerSettings } from "./shared/settings.js";
import { createOpenAiProvider } from "./server/provider.js";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(providerSettings);
  server.registerProvider(
    createOpenAiProvider(async () => {
      const state = await settings.read();
      if (state.status !== "ready") throw new Error(state.error);
      return state.values;
    }),
  );
  return () => {};
}
