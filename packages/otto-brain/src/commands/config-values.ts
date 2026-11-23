/* Pure key validation shared by standalone files and selected-owner adapters. */
import { BrainConfigSchema, type BrainConfig } from "../config/schema.js";
import { CommandError } from "../output/types.js";

const NULLABLE = new Set([
  "modelsDir",
  "hfToken",
  "defaultModel",
  "auth.token",
  "runtime.path",
  "tls.certFile",
  "tls.keyFile",
  "tls.hostname",
  "tls.certDir",
  "tls.tailscaleExe",
]);
function inputValue(key: string, previous: unknown, raw: string): unknown {
  if ((key === "auth.token" || key === "hfToken") && (raw.trim() === "" || raw === "********"))
    throw new CommandError({
      code: "INVALID_VALUE",
      message: "Use a nonblank key or explicit null, never a redacted placeholder.",
    });
  if (raw === "null" && NULLABLE.has(key)) return null;
  if (typeof previous === "boolean") {
    return parseConfigBoolean(raw);
  }
  if (typeof previous === "number") return raw.trim() === "" ? raw : Number(raw);
  if (Array.isArray(previous)) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new CommandError(
        { code: "INVALID_VALUE", message: "Use a JSON array for this setting" },
        { cause: error },
      );
    }
  }
  return raw;
}
const GROUPS = ["listen", "runtime", "auth", "tls", "defaults"] as const;
function isGroup(value: string): value is (typeof GROUPS)[number] {
  return GROUPS.some((group) => group === value);
}
function unknownKey(): never {
  throw new CommandError({
    code: "UNKNOWN_KEY",
    message: "Unknown or read-only Brain configuration key",
  });
}
/** Validate a known leaf against the complete persisted schema, without truthy coercion. */
export function applyConfigKey(config: BrainConfig, key: string, raw: string): BrainConfig {
  const [group, field, ...extra] = key.split(".");
  if (!group || extra.length || group === "version") return unknownKey();
  let candidate: unknown;
  if (field !== undefined) {
    if (!isGroup(group)) return unknownKey();
    const previous = Object.entries(config[group]).find(([name]) => name === field);
    if (!previous) return unknownKey();
    candidate = {
      ...config,
      [group]: { ...config[group], [field]: inputValue(key, previous[1], raw) },
    };
  } else {
    const previous = Object.entries(config).find(([name]) => name === group);
    if (!previous || isGroup(group)) return unknownKey();
    candidate = { ...config, [group]: inputValue(key, previous[1], raw) };
  }
  const parsed = BrainConfigSchema.safeParse(candidate);
  if (!parsed.success)
    throw new CommandError({
      code: "INVALID_VALUE",
      message: "Invalid value for the Brain configuration setting",
    });
  if (parsed.data.auth.mode === "token" && !parsed.data.auth.token) {
    throw new CommandError({
      code: "TOKEN_REQUIRED",
      message: "auth.mode=token requires auth.token to be set first",
      details: "run `otto brain config set auth.token <token>` before enabling token auth",
    });
  }
  if (key === "runtime.source") parsed.data.runtime.path = null;
  return parsed.data;
}

export function parseConfigBoolean(raw: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new CommandError({
    code: "INVALID_VALUE",
    message: "Use true or false for a boolean setting",
  });
}

/** Called after applyConfigKey; only this explicit leaf may be persisted. */
export function selectedConfigValue(config: BrainConfig, key: string): unknown {
  const [group, field] = key.split(".");
  const value: unknown = Object.entries(config).find(([name]) => name === group)?.[1];
  if (field === undefined) return value;
  if (!value || typeof value !== "object") return unknownKey();
  return Object.entries(value).find(([name]) => name === field)?.[1];
}
