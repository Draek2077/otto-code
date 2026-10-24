/**
 * `otto brain config show|set` - inspect and edit the persisted config at
 * $OTTO_HOME/otto-brain/config.json. Opt-in flags (`enabled`, `autoStart`) live
 * here; the Otto daemon reads them to decide whether to manage the brain.
 */
import type { Command } from "commander";

import { loadBrainConfig, readBrainConfigRevision, updateBrainConfig } from "../config/index.js";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";
import { redactBrainConfig } from "../config/redact.js";
import { applyConfigKey } from "./config-values.js";
import { selectedBrainSettingsTarget, type BrainConfigCommandResult } from "./settings-target.js";

const configSchema: OutputSchema<BrainConfigCommandResult> = {
  idField: () => "config",
  columns: [{ header: "CONFIG", field: () => "config" }],
  renderHuman: (data) => JSON.stringify(data, null, 2),
  serialize: (data) => data,
};

export async function runConfigShowCommand(
  _options: unknown,
  _command: Command,
): Promise<AnyCommandResult<BrainConfigCommandResult>> {
  const target = selectedBrainSettingsTarget();
  return {
    type: "single",
    data: target ? await target.readConfig() : redactBrainConfig(loadBrainConfig()),
    schema: configSchema,
  };
}

export async function runConfigSetCommand(
  key: string,
  value: string,
  _options: unknown,
  _command: Command,
): Promise<AnyCommandResult<BrainConfigCommandResult>> {
  const target = selectedBrainSettingsTarget();
  if (target)
    return { type: "single", data: await target.setConfig(key, value), schema: configSchema };
  const origin = readBrainConfigRevision();
  const config = applyConfigKey(origin.config, key, value);
  updateBrainConfig(origin.revision, () => config);
  return { type: "single", data: redactBrainConfig(config), schema: configSchema };
}

export { addConfigShowOptions, addConfigSetOptions } from "./options.js";
