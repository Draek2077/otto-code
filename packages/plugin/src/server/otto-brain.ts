/** Otto-owned node-only Brain provider composition; the full harness is shared with F01. */
import path from "node:path";
import { z } from "zod";
import {
  BrainConnectionStore,
  localBrainClient,
  remoteBrainClient,
  readPidFile,
  isProcessAlive,
  loadBrainConfig,
} from "@getpaseo/brain/client";
import { createOpenAiProvider } from "../otto/openai/server/provider.js";
import { providerSettings } from "../otto/openai/shared/settings.js";
import { LegacyProviders } from "../otto/openai/server/legacy-config.js";
import { endpoint } from "../otto/openai/server/http.js";

const baseUrl = "https://otto-brain.invalid/v1";
const revisionSchema = z.object({
  instanceId: z.string(),
  libraryRevision: z.number().int().nonnegative(),
  ownerSettingsRevision: z.string().nullable(),
});

/** Every request resolves the current owner. No model/host is started by registration,
 * catalog discovery or a settings read. Credentials never enter shared plugin settings. */
export function brainProviderProfiles(home: string) {
  return new LegacyProviders(home).brainProfiles();
}
export function createBrainProvider(
  home: string,
  identity: { id?: string; label?: string } = {},
): ReturnType<typeof createOpenAiProvider> {
  if (!path.isAbsolute(home)) throw new Error("Brain requires the owning daemon's resolved home");
  const connection = new BrainConnectionStore(path.join(home, "otto-config.json"));
  const env = { ...process.env, OTTO_HOME: home };
  const id = identity.id ?? "otto-brain";
  const legacy = new LegacyProviders(home);
  function client() {
    const intent = connection.resolve();
    if (!intent.enabled) throw new Error("Enable Brain in this host's Brain settings");
    if (intent.mode === "remote") return remoteBrainClient(intent.remote);
    const record = readPidFile(env);
    if (!record || !isProcessAlive(record.pid))
      throw new Error("Start Brain on this host before selecting its models");
    return localBrainClient({ record, env, config: loadBrainConfig(env) });
  }
  const transport: typeof fetch = async (input, init) => {
    // A virtual endpoint is only a stable saved-chat identity. It is never resolved
    // by fetch/DNS, and caller-supplied URLs/headers cannot bypass owner trust.
    if (typeof input !== "string") throw new Error("Unsupported Brain inference request");
    const catalog = input === `${baseUrl}/models` && (!init?.method || init.method === "GET");
    const completion = input === `${baseUrl}/chat/completions` && init?.method === "POST";
    if (!catalog && !completion) throw new Error("Unsupported Brain inference operation");
    if (init?.body !== undefined && typeof init.body !== "string")
      throw new Error("Brain inference requires a JSON body");
    return client().completionRequest(
      catalog ? "/v1/models" : "/v1/chat/completions",
      init?.body,
      init?.signal ?? undefined,
    );
  };
  async function readSettings() {
    const profile = legacy.brainProfiles().find((value) => value.id === id);
    if (!profile || !profile.enabled)
      throw new Error("This Brain provider is disabled or its preserved identity is unavailable");
    if (profile.diagnostic) throw new Error(profile.diagnostic);
    client();
    return providerSettings.schema.parse({
      baseUrl,
      apiKeyEnv: "OTTO_BRAIN_PRIVATE_OWNER_KEY",
      model: profile.model,
      maxToolRounds: profile.maxToolRounds,
    });
  }
  const provider = createOpenAiProvider(readSettings, {
    id,
    label: identity.label ?? "Otto Brain",
    home,
    imageDirectory: path.join(home, "otto-brain", "agent-images"),
    sessionDirectory: path.join(home, "otto-brain", "agent-sessions"),
    transport,
    compaction: { keepRecentTokens: 6000, summaryMaxTokens: 4000 },
    resolveLegacyEndpoint(providerId) {
      if (providerId !== id || !legacy.originalBrainIdentity(providerId))
        throw new Error(
          "The original Brain provider identity cannot be verified. Its history was left intact.",
        );
      return endpoint(baseUrl, "chat/completions");
    },
    resolveApiKey: async () => "",
    async catalogRevision() {
      const revision = revisionSchema.parse(await client().request("/__host/status"));
      return JSON.stringify([
        connection.read().revision,
        revision.instanceId,
        revision.libraryRevision,
        revision.ownerSettingsRevision,
      ]);
    },
  });
  return {
    ...provider,
    description: "Use this host's local or Remote Brain with Otto's full agent tools.",
    async status() {
      try {
        await readSettings();
        await client().request("/health");
        return { available: true };
      } catch {
        return {
          available: false,
          diagnostic:
            "Brain is disabled or unavailable. Open this host's Brain settings and start or connect its owner.",
        };
      }
    },
  };
}
