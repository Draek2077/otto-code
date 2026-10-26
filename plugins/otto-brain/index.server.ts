import {
  registerProviderContext,
  type ContextInspectableProvider,
} from "@getpaseo/plugin/server/otto-openai";
import type { PluginServerContext, PluginServerContribution } from "@getpaseo/plugin/server";
import { createBrainProvider, brainProviderProfiles } from "@getpaseo/plugin/server/otto-brain";
import { z } from "zod";

/** Management effects stay in the daemon. Provider sessions use the same public owner transport. */
export default function contribute(
  server: PluginServerContext,
): ReturnType<PluginServerContribution> {
  const contextProviders: ContextInspectableProvider[] = [];
  const register = (provider: ReturnType<typeof createBrainProvider> & { icon?: string }) => {
    contextProviders.push(provider);
    server.registerProvider(provider);
  };
  const home = process.env.OTTO_PROVIDER_HOST_HOME;
  if (!home) throw new Error("Brain requires the daemon's resolved host context");
  register({ ...createBrainProvider(home), icon: "brain.svg" });
  const reserved = new Set(
    z.array(z.string()).parse(JSON.parse(process.env.OTTO_PROVIDER_RESERVED_IDS ?? "null")),
  );
  let profiles: ReturnType<typeof brainProviderProfiles> = [];
  try {
    profiles = brainProviderProfiles(home);
  } catch {
    /* Main provider status reports invalid preserved configuration. */
  }
  for (const profile of profiles) {
    if (profile.id !== "otto-brain" && !reserved.has(profile.id))
      register({
        ...createBrainProvider(home, { id: profile.id, label: profile.label }),
        icon: "brain.svg",
      });
  }
  // Provider registration and connection cleanup belong to the SDK runtime.
  registerProviderContext(server, contextProviders);
  return () => {};
}
