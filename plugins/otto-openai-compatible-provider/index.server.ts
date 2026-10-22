import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createOpenAiProvider } from "./server/provider.js";
import path from "node:path";
import { HostCredentials } from "./server/credentials.js";
import { registerHostCredentials } from "./server/credential-handlers.js";
import { LegacyProviders, legacySettingsDefinition } from "./server/legacy-config.js";
import { legacyStatus } from "./shared/legacy.js";
import { z } from "zod";
import { endpoint } from "./server/http.js";

export default function contribute(server: PluginServerContext) {
  const home = process.env.OTTO_PROVIDER_HOST_HOME;
  // The daemon owns its reserved identities. Plugin source compiles from a
  // separate resources directory in desktop builds, so depend only on the SDK
  // and its host-provided context rather than importing daemon-private packages.
  const reserved = new Set(
    z.array(z.string()).parse(JSON.parse(process.env.OTTO_PROVIDER_RESERVED_IDS ?? "null")),
  );
  const legacy = home ? new LegacyProviders(home) : undefined;
  let initial;
  try {
    initial = legacy?.profile("openai-compatible");
  } catch {
    /* Report preserved-file errors through status without resetting anything. */
  }
  const settings = server.registerSettings(legacySettingsDefinition(initial?.settings));
  const credentials = home
    ? new HostCredentials(path.join(home, "otto-openai-compatible"))
    : undefined;
  const readSettings = async () => {
    const state = await settings.read();
    if (state.status !== "ready") throw new Error(state.error);
    return state;
  };
  registerHostCredentials({
    server,
    credentials,
    readSettings,
    legacyKey: (profile) => legacy?.key("openai-compatible", profile),
    onRetire: (profileId) => provider.retireProfile(profileId),
  });
  const legacyProfiles = () =>
    (legacy?.ids() ?? []).flatMap((id) => {
      const profile = legacy?.profile(id);
      return profile ? [profile] : [];
    });
  server.handle(legacyStatus, () => {
    try {
      return {
        providers: legacyProfiles().map(({ id, label, enabled, diagnostic }) => ({
          id,
          label,
          enabled,
          diagnostic: reserved.has(id)
            ? "This preserved identity conflicts with a Paseo built-in and was left inactive."
            : diagnostic,
        })),
      };
    } catch (error) {
      return {
        providers: [],
        error:
          error instanceof Error ? error.message : "Preserved provider settings could not be read.",
      };
    }
  });
  const provider = createOpenAiProvider(async () => (await readSettings()).values, {
    imageDirectory: home ? path.join(home, "otto-openai-compatible", "images") : undefined,
    home,
    sessionDirectory: home ? path.join(home, "otto-openai-compatible", "sessions") : undefined,
    label: "OpenAI Compatible API",
    resolveApiKey: async (profile) => {
      const old = legacy?.profile("openai-compatible");
      if (
        profile.id === "primary" &&
        old?.settings.baseUrl &&
        endpoint(old.settings.baseUrl, "chat/completions") ===
          endpoint(profile.settings.baseUrl, "chat/completions")
      ) {
        if (!old.enabled) throw new Error("This provider is disabled in preserved Otto settings.");
        if (old.diagnostic) throw new Error(old.diagnostic);
      }
      return (
        (await credentials?.key(profile.id, profile.settings.baseUrl)) ??
        legacy?.key("openai-compatible", profile)
      );
    },
  });
  server.registerProvider(provider);
  let aliases: ReturnType<typeof legacyProfiles> = [];
  try {
    aliases = legacyProfiles();
  } catch {
    /* Exposed through legacy.status. */
  }
  for (const alias of aliases) {
    if (alias.id === "openai-compatible" || reserved.has(alias.id)) continue;
    server.registerProvider(
      createOpenAiProvider(
        async () => {
          const profile = legacy!.profile(alias.id);
          if (!profile)
            throw new Error(
              "Restore this provider's preserved Otto configuration before continuing.",
            );
          if (!profile.enabled)
            throw new Error("This provider is disabled in preserved Otto settings.");
          if (profile.diagnostic) throw new Error(profile.diagnostic);
          return profile.settings;
        },
        {
          id: alias.id,
          label: alias.label,
          imageDirectory: home ? path.join(home, "otto-openai-compatible", "images") : undefined,
          home,
          sessionDirectory: home
            ? path.join(home, "otto-openai-compatible", "sessions")
            : undefined,
          resolveApiKey: async (profile) => legacy?.key(alias.id, profile),
        },
      ),
    );
  }
  return () => {};
}
