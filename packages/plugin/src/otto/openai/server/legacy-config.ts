import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { providerSettings, type ConnectionSettings } from "../shared/settings.js";
import type { EndpointProfile } from "./endpoints.js";
import { endpoint } from "./http.js";

const record = z.record(z.string(), z.unknown());
const supported = new Set([
  "extends",
  "label",
  "description",
  "enabled",
  "env",
  "model",
  "maxToolRounds",
]);
interface LegacyProfile {
  id: string;
  label: string;
  enabled: boolean;
  settings: ConnectionSettings;
  diagnostic?: string;
}
export interface LegacyBrainProfile {
  id: string;
  label: string;
  enabled: boolean;
  model: string;
  maxToolRounds: number;
  diagnostic?: string;
}
function resolveBrain(
  id: string,
  providers: Record<string, unknown>,
  trail: string[] = [],
): Record<string, unknown> | undefined {
  if (trail.includes(id) || trail.length > 32) return undefined;
  const current = object(providers[id]);
  if (id === "otto-brain") {
    if (current.extends && current.extends !== id) return undefined;
    return current;
  }
  if (typeof current.extends !== "string") return undefined;
  const parent = resolveBrain(current.extends, providers, [...trail, id]);
  return parent
    ? { ...parent, ...current, env: { ...object(parent.env), ...object(current.env) } }
    : undefined;
}
function brainProfile(id: string, value: Record<string, unknown>): LegacyBrainProfile {
  const allowed = new Set([
    "extends",
    "label",
    "description",
    "enabled",
    "env",
    "model",
    "maxToolRounds",
  ]);
  const unsupported = [
    ...Object.keys(value).filter((key) => !allowed.has(key) && value[key] != null),
    ...Object.keys(object(value.env)).map((key) => `env.${key}`),
  ];
  const settings = providerSettings.schema.parse({
    model: value.model,
    maxToolRounds: value.maxToolRounds,
  });
  return {
    id,
    label: typeof value.label === "string" && value.label.trim() ? value.label : id,
    enabled: value.enabled !== false,
    model: settings.model,
    maxToolRounds: settings.maxToolRounds,
    ...(unsupported.length
      ? {
          diagnostic: `Preserved Brain options need supported mappings: ${unsupported.join(", ")}. Original settings were left intact.`,
        }
      : {}),
  };
}
function object(value: unknown): Record<string, unknown> {
  return record.parse(value ?? {});
}
function readProviders(directory: string, filename: string): Record<string, unknown> {
  const file = path.join(directory, filename);
  let raw: string;
  try {
    if (statSync(file).size > 4 * 1024 * 1024) throw new Error("Large config");
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(
      `Preserved Otto provider configuration in ${filename} is invalid. The file was left intact.`,
      { cause: error },
    );
  }
  try {
    const root = object(JSON.parse(raw));
    return object(object(root.agents).providers);
  } catch {
    // Do not attach a JSON parser error: its source excerpt can contain a key.
    throw new Error(
      `Preserved Otto provider configuration in ${filename} is invalid. The file was left intact.`,
    );
  }
}
function resolve(
  id: string,
  providers: Record<string, unknown>,
  trail: string[] = [],
): Record<string, unknown> | undefined {
  if (id === "otto-brain" || trail.includes(id) || trail.length > 32) return undefined;
  if (!Object.hasOwn(providers, id)) return undefined;
  const current = object(providers[id]);
  if (id === "openai-compatible" && (!current.extends || current.extends === id)) return current;
  if (typeof current.extends !== "string") return undefined;
  const parent =
    current.extends === "openai-compatible" && !Object.hasOwn(providers, current.extends)
      ? {}
      : resolve(current.extends, providers, [...trail, id]);
  if (!parent) return undefined;
  return { ...parent, ...current, env: { ...object(parent.env), ...object(current.env) } };
}

/** COMPAT(otto09Providers): added in v0.10.0; review after 2027-04-22.
 * Read the existing sidecar rather than copying credentials into new settings.
 * Brain and anything derived from Brain remain inactive. No legacy file is written.
 */
export class LegacyProviders {
  constructor(private readonly home: string) {}
  private current() {
    return {
      ...readProviders(this.home, "config.json"),
      ...readProviders(this.home, "otto-config.json"),
    };
  }
  ids(): string[] {
    const providers = this.current();
    return Object.keys(providers)
      .filter((id) => resolve(id, providers))
      .sort();
  }
  /** COMPAT(otto09BrainProviders): v0.10.0, remove after 2027-04-23.
   * Brain aliases bind to the owning Brain service, never a copied URL/key. */
  brainProfiles(): LegacyBrainProfile[] {
    const providers = this.current();
    return [...new Set(["otto-brain", ...Object.keys(providers)])].flatMap((id) => {
      const value = resolveBrain(id, providers);
      return value ? [brainProfile(id, value)] : [];
    });
  }
  originalBrainIdentity(id: string): boolean {
    // The native Brain ID was owner-derived, without a provider URL. An alias
    // additionally needs its original saved inheritance before history imports.
    return (
      id === "otto-brain" ||
      Boolean(resolveBrain(id, readProviders(this.home, "config.json.otto-0.9.bak")))
    );
  }
  profile(id: string): LegacyProfile | undefined {
    const value = resolve(id, this.current());
    if (!value) return undefined;
    const env = object(value.env);
    const unsupported = [
      ...Object.keys(value).filter((key) => !supported.has(key) && value[key] != null),
      ...Object.keys(env)
        .filter((key) => !["OPENAI_BASE_URL", "OPENAI_API_KEY"].includes(key))
        .map((key) => `env.${key}`),
    ];
    const settings = providerSettings.schema.parse({
      baseUrl: typeof env.OPENAI_BASE_URL === "string" ? env.OPENAI_BASE_URL.trim() : "",
      model: value.model,
      maxToolRounds: value.maxToolRounds,
    });
    return {
      id,
      label: typeof value.label === "string" && value.label.trim() ? value.label : id,
      enabled: value.enabled !== false,
      settings,
      ...(unsupported.length
        ? {
            diagnostic: `Preserved settings need review before this legacy provider can run: ${unsupported.join(", ")}. No historical policy was discarded.`,
          }
        : {}),
    };
  }
  key(id: string, profile: EndpointProfile): string | undefined {
    if (profile.id !== "primary") return undefined;
    const env = object(resolve(id, this.current())?.env);
    if (
      typeof env.OPENAI_BASE_URL !== "string" ||
      endpoint(env.OPENAI_BASE_URL.trim(), "chat/completions") !==
        endpoint(profile.settings.baseUrl, "chat/completions")
    )
      return undefined;
    return typeof env.OPENAI_API_KEY === "string"
      ? env.OPENAI_API_KEY.trim() || undefined
      : undefined;
  }
  originalEndpoint(id: string): string {
    const original = resolve(id, readProviders(this.home, "config.json.otto-0.9.bak"));
    const url = object(original?.env).OPENAI_BASE_URL;
    if (typeof url !== "string" || !url.trim())
      throw new Error(
        "The original Otto provider endpoint cannot be verified. Restore its preserved configuration before importing this conversation. Its history was left intact.",
      );
    return endpoint(url.trim(), "chat/completions");
  }
}

export function legacySettingsDefinition(defaults?: ConnectionSettings) {
  if (!defaults) return providerSettings;
  const shape = providerSettings.schema.shape;
  return {
    ...providerSettings,
    schema: providerSettings.schema.extend({
      baseUrl: shape.baseUrl.unwrap().default(defaults.baseUrl),
      model: shape.model.unwrap().default(defaults.model),
      maxToolRounds: shape.maxToolRounds.unwrap().default(defaults.maxToolRounds),
    }),
  };
}
