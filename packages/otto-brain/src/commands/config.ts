/**
 * `otto brain config show|set` - inspect and edit the persisted config at
 * $OTTO_HOME/otto-brain/config.json. Opt-in flags (`enabled`, `autoStart`) live
 * here; the Otto daemon reads them to decide whether to manage the brain.
 */
import type { Command } from "commander";

import { loadBrainConfig, readBrainConfigRevision, updateBrainConfig } from "../config/index.js";
import { BrainConfigSchema, type BrainConfig } from "../config/schema.js";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";
import { CommandError } from "../output/types.js";
import { redactBrainConfig } from "../config/redact.js";

const configSchema: OutputSchema<BrainConfig> = {
  idField: () => "config",
  columns: [{ header: "CONFIG", field: () => "config" }],
  renderHuman: (data) => JSON.stringify(data, null, 2),
  serialize: (data) => data,
};

export function addConfigShowOptions(cmd: Command): Command {
  return cmd.description("Show the effective brain config");
}

export async function runConfigShowCommand(
  _options: unknown,
  _command: Command,
): Promise<AnyCommandResult<BrainConfig>> {
  return { type: "single", data: redactBrainConfig(loadBrainConfig()), schema: configSchema };
}

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
  if (raw === "null" && NULLABLE.has(key)) return null;
  if (typeof previous === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new CommandError({
      code: "INVALID_VALUE",
      message: "Use true or false for a boolean setting",
    });
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
function applyKey(config: BrainConfig, key: string, raw: string): BrainConfig {
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
  return parsed.data;
}
export function addConfigSetOptions(cmd: Command): Command {
  return cmd
    .description("Set a config value")
    .argument("<key>", "config key (e.g. enabled, listen.port, runtime.source)")
    .argument("<value>", "new value");
}

export async function runConfigSetCommand(
  key: string,
  value: string,
  _options: unknown,
  _command: Command,
): Promise<AnyCommandResult<BrainConfig>> {
  const origin = readBrainConfigRevision();
  const config = applyKey(origin.config, key, value);
  updateBrainConfig(origin.revision, () => config);
  return { type: "single", data: redactBrainConfig(config), schema: configSchema };
}
