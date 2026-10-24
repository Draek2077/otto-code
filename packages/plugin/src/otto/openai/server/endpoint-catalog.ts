import { createHash } from "node:crypto";
import type { ProviderModel } from "../../../server/provider.js";
import type { ConnectionSettings } from "../shared/settings.js";
import { discoverModels } from "./catalog.js";
import { endpointProfiles, qualifyModel, type EndpointProfile } from "./endpoints.js";

export type ResolveApiKey = (profile: EndpointProfile) => Promise<string | undefined>;
interface EndpointDiscovery {
  profile: EndpointProfile;
  key?: string;
  error?: string;
}

function discoveryKey(bindings: EndpointDiscovery[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        bindings.map(({ profile, key, error }) => ({
          id: profile.id,
          label: profile.label,
          url: profile.settings.baseUrl,
          model: profile.settings.model,
          env: profile.settings.apiKeyEnv,
          key,
          error,
        })),
      ),
    )
    .digest("hex");
}

function unavailable(profile: EndpointProfile, message: string): ProviderModel {
  return {
    id: qualifyModel(profile.id, "$otto-unavailable"),
    label: `${profile.label} (unavailable)`,
    isSelectable: false,
    description: `${profile.label}: ${message}`,
    metadata: { endpointProfileId: profile.id },
  };
}

export class EndpointCatalog {
  private latest: { key: string; models: ProviderModel[] } | undefined;
  constructor(
    private readonly resolveApiKey?: ResolveApiKey,
    private readonly transport?: typeof fetch,
    private readonly revision?: () => Promise<string>,
  ) {}

  private async revisionKey(bindings: EndpointDiscovery[]): Promise<string> {
    const key = discoveryKey(bindings);
    return this.revision ? `${key}:${await this.revision()}` : key;
  }

  async credential(
    profile: EndpointProfile,
    env: Readonly<Record<string, string | undefined>> = process.env,
  ): Promise<string | undefined> {
    return (
      (await this.resolveApiKey?.(profile)) ??
      env[profile.settings.apiKeyEnv] ??
      process.env[profile.settings.apiKeyEnv]
    );
  }

  private async bindings(settings: ConnectionSettings): Promise<EndpointDiscovery[]> {
    const profiles = endpointProfiles(settings);
    if (!profiles.length) throw new Error("Configure an OpenAI-compatible endpoint first.");
    return Promise.all(
      profiles.map(async (profile) => {
        try {
          return { profile, key: await this.credential(profile) };
        } catch (error) {
          return {
            profile,
            error: error instanceof Error ? error.message : "Host credentials are unavailable.",
          };
        }
      }),
    );
  }

  async key(settings: ConnectionSettings): Promise<string> {
    return this.revisionKey(await this.bindings(settings));
  }

  async models(
    settings: ConnectionSettings,
    signal: AbortSignal,
    refresh = false,
  ): Promise<ProviderModel[]> {
    const bindings = await this.bindings(settings);
    const key = await this.revisionKey(bindings);
    if (!refresh && this.latest?.key === key) return this.latest.models;
    const batches = await Promise.all(
      bindings.map(async ({ profile, key: apiKey, error: credentialError }) => {
        if (credentialError) return [unavailable(profile, credentialError)];
        try {
          return (await discoverModels(profile.settings, signal, apiKey, this.transport)).map(
            (model) => {
              model.id = qualifyModel(profile.id, model.id);
              if (profile.id !== "primary") model.label = `${profile.label} / ${model.label}`;
              model.metadata = Object.assign({}, model.metadata, { endpointProfileId: profile.id });
              return model;
            },
          );
        } catch (error) {
          signal.throwIfAborted();
          return [
            unavailable(
              profile,
              error instanceof Error ? error.message : "Model discovery failed.",
            ),
          ];
        }
      }),
    );
    const models = batches.flat();
    this.latest = { key, models };
    return models;
  }
}
