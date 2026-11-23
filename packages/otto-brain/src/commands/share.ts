/**
 * `otto brain share` - opt a brain into being reachable (and optionally
 * configurable) by other Otto hosts. Off by default: a brain binds loopback and
 * is invisible to the network until its owner runs this. Sets the bind, the
 * access level (open on a trusted network, or a bearer key), HTTPS, and whether
 * key holders may reconfigure it. Writes $OTTO_HOME/otto-brain/config.json - the
 * same fields the Otto app's Sharing UI sets, so the two stay in sync.
 */
import { randomBytes } from "node:crypto";
import type { Command } from "commander";
import { readBrainConfigRevision, updateBrainConfig } from "../config/index.js";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";
import * as tailscale from "../service/tailscale.js";
import { selectShareOptions, type ShareOptions, type ShareStatus } from "./share-contract.js";
import { prepareSharing, sharingStatus } from "./share-policy.js";
import { selectedBrainSettingsTarget } from "./settings-target.js";
export type { ShareOptions } from "./share-contract.js";

const shareSchema: OutputSchema<ShareStatus> = {
  idField: () => "share",
  columns: [{ header: "SHARE", field: () => "share" }],
  renderHuman: (data) => {
    const d = Array.isArray(data) ? data[0] : data;
    if (!d) return "";
    const lines = [
      `Sharing:       ${d.shared ? "on" : "off (loopback only)"}`,
      `Bind:          ${d.bind}`,
      `Access:        ${d.access}${d.access === "key" && !d.hasKey ? " (no key set!)" : ""}`,
      `HTTPS:         ${d.https}`,
      `Remote config: ${d.allowRemoteConfig ? "allowed" : "disabled"}`,
    ];
    if (d.requiresRestart) lines.push("Restart required: yes (saved settings are staged)");
    if (d.key) {
      lines.push("", "Access key (copy this to the connecting host):", `  ${d.key}`);
    }
    return lines.join("\n");
  },
  serialize: (d) => d,
};

export async function runShareCommand(
  options: ShareOptions,
  _command: Command,
): Promise<AnyCommandResult<ShareStatus>> {
  const selected = selectedBrainSettingsTarget();
  if (selected)
    return {
      type: "single",
      data: await selected.share(selectShareOptions(options)),
      schema: shareSchema,
    };
  const origin = readBrainConfigRevision();
  const prepared = await prepareSharing(origin.config, options, {
    tailnetAvailable: () => tailscale.isAvailable(),
    generateKey: () => randomBytes(24).toString("base64url"),
  });
  if (prepared.changed) updateBrainConfig(origin.revision, () => prepared.config);
  return {
    type: "single",
    data: sharingStatus(prepared.config, prepared.key),
    schema: shareSchema,
  };
}
export { addShareOptions } from "./options.js";
