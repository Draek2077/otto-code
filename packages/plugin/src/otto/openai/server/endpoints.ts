import type { ConnectionSettings } from "../shared/settings.js";

const prefix = "otto-endpoint/";
export interface EndpointProfile {
  id: string;
  label: string;
  settings: ConnectionSettings;
}

export function endpointProfiles(
  settings: ConnectionSettings,
  includeDisabled = false,
): EndpointProfile[] {
  const { endpoints, ...primary } = settings;
  return [
    ...(primary.baseUrl ? [{ id: "primary", label: "Primary endpoint", settings: primary }] : []),
    ...(endpoints ?? [])
      .filter((profile) => includeDisabled || profile.enabled !== false)
      .map((profile) => ({
        id: profile.id,
        label: profile.label,
        settings: {
          ...primary,
          baseUrl: profile.baseUrl,
          model: profile.model,
          apiKeyEnv: profile.apiKeyEnv,
        },
      })),
  ];
}

export function qualifyModel(profileId: string, modelId: string): string {
  if (profileId === "primary" && !modelId.startsWith(prefix)) return modelId;
  return `${prefix}${profileId}/${encodeURIComponent(modelId)}`;
}

export function modelReference(id: string): { profileId: string; modelId: string } {
  if (!id.startsWith(prefix)) return { profileId: "primary", modelId: id };
  const match = /^otto-endpoint\/([a-z][a-z0-9-]{0,62})\/(.+)$/.exec(id);
  if (!match) throw new Error("Invalid endpoint model reference.");
  try {
    const modelId = decodeURIComponent(match[2]!);
    if (!modelId.trim()) throw new Error("Missing model ID");
    return { profileId: match[1]!, modelId };
  } catch {
    throw new Error("Invalid endpoint model reference.");
  }
}
