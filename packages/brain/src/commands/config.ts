/**
 * `otto brain config show|set` — inspect and edit the persisted config at
 * $OTTO_HOME/otto-brain/config.json. Opt-in flags (`enabled`, `autoStart`) live
 * here; the Otto daemon reads them to decide whether to manage the brain.
 */
import type { Command } from "commander";

import { loadBrainConfig, loadPersistedConfig, saveBrainConfig } from "../config/index.js";
import type { BrainConfig } from "../config/schema.js";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";
import { CommandError } from "../output/types.js";

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
  return { type: "single", data: loadBrainConfig(), schema: configSchema };
}

function parseValue(raw: string): boolean | number | string {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const num = Number(raw);
  return Number.isFinite(num) && raw.trim() !== "" ? num : raw;
}

/** Apply a dotted key (e.g. listen.port, runtime.source) to a mutable config. */
function applyKey(config: BrainConfig, key: string, value: boolean | number | string): void {
  switch (key) {
    case "enabled":
      config.enabled = Boolean(value);
      return;
    case "autoStart":
      config.autoStart = Boolean(value);
      return;
    case "listen.host":
      config.listen.host = String(value);
      return;
    case "listen.port":
      config.listen.port = Number(value);
      return;
    case "defaultModel":
      config.defaultModel = String(value);
      return;
    case "runtime.source":
      config.runtime.source = value as BrainConfig["runtime"]["source"];
      return;
    case "auth.mode":
      config.auth.mode = value as BrainConfig["auth"]["mode"];
      return;
    case "auth.token":
      config.auth.token = String(value);
      return;
    case "tls.mode":
      config.tls.mode = value as BrainConfig["tls"]["mode"];
      return;
    case "tls.certFile":
      config.tls.certFile = String(value);
      return;
    case "tls.keyFile":
      config.tls.keyFile = String(value);
      return;
    case "tls.hostname":
      config.tls.hostname = String(value);
      return;
    case "tls.certDir":
      config.tls.certDir = String(value);
      return;
    case "tls.renewBeforeDays":
      config.tls.renewBeforeDays = Number(value);
      return;
    case "tls.tailscaleExe":
      config.tls.tailscaleExe = String(value);
      return;
    default:
      throw new CommandError({ code: "UNKNOWN_KEY", message: `unknown config key "${key}"` });
  }
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
  const config = loadPersistedConfig();
  applyKey(config, key, parseValue(value));
  saveBrainConfig(config);
  return { type: "single", data: config, schema: configSchema };
}
