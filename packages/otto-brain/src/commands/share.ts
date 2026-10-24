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
import type { BrainConfig } from "../config/schema.js";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";
import { CommandError } from "../output/types.js";
import * as tailscale from "../service/tailscale.js";

interface ShareStatus {
  shared: boolean;
  bind: string;
  access: "open" | "key" | "none";
  hasKey: boolean;
  /** The access key, only when it was just generated (so it is shown once). */
  key: string | null;
  https: string;
  allowRemoteConfig: boolean;
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost" || host === "";
}

function toStatus(config: BrainConfig, generatedKey: string | null): ShareStatus {
  const shared = !isLoopback(config.listen.host);
  let access: ShareStatus["access"] = shared ? "open" : "none";
  if (config.auth.mode === "token") access = "key";
  return {
    shared,
    bind: config.listen.host,
    access,
    hasKey: Boolean(config.auth.token),
    key: generatedKey,
    https: config.tls.mode,
    allowRemoteConfig: config.allowRemoteConfig,
  };
}

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
    if (d.key) {
      lines.push("", "Access key (copy this to the connecting host):", `  ${d.key}`);
    }
    return lines.join("\n");
  },
  serialize: (d) => d,
};

export interface ShareOptions {
  on?: boolean;
  off?: boolean;
  bind?: string;
  access?: string;
  key?: string;
  generate?: boolean;
  allowConfig?: boolean;
  https?: string;
}

function resolveBind(bind: string): string {
  if (bind === "all") return "0.0.0.0";
  if (bind === "tailscale") return "tailscale";
  return bind;
}

function validateAccess(access: string): "open" | "key" {
  if (access !== "open" && access !== "key") {
    throw new CommandError({ code: "BAD_ACCESS", message: `--access must be "open" or "key"` });
  }
  return access;
}

export async function runShareCommand(
  options: ShareOptions,
  _command: Command,
): Promise<AnyCommandResult<ShareStatus>> {
  const origin = readBrainConfigRevision();
  const config = origin.config;

  const anyChange = hasShareChange(options);
  if (!anyChange) {
    return { type: "single", data: toStatus(config, null), schema: shareSchema };
  }

  if (options.off) {
    config.listen.host = "127.0.0.1";
    config.auth.mode = "none";
    config.allowInsecureBind = false;
    config.allowRemoteConfig = false;
    updateBrainConfig(origin.revision, () => config);
    return { type: "single", data: toStatus(config, null), schema: shareSchema };
  }

  // Bind: explicit wins; otherwise turning on a loopback brain defaults to the
  // tailnet when Tailscale is present (private + encrypted), else all interfaces.
  if (options.bind !== undefined) {
    config.listen.host = resolveBind(options.bind);
  } else if (options.on && isLoopback(config.listen.host)) {
    config.listen.host = (await tailscale.isAvailable()) ? "tailscale" : "0.0.0.0";
  }

  // Access: key by default when turning on (secure by default). "open" allows an
  // unauthenticated non-loopback bind for a trusted network.
  const access = selectedAccess(options, config);

  let generatedKey: string | null = null;
  if (access === "open") {
    config.auth.mode = "none";
    config.allowInsecureBind = true;
  } else {
    config.auth.mode = "token";
    config.allowInsecureBind = false;
    if (options.key !== undefined) {
      config.auth.token = options.key;
    } else if (options.generate || !config.auth.token) {
      generatedKey = randomBytes(24).toString("base64url");
      config.auth.token = generatedKey;
    }
  }

  if (options.https !== undefined) {
    const mode = options.https;
    if (mode !== "off" && mode !== "self-signed" && mode !== "tailscale" && mode !== "files") {
      throw new CommandError({
        code: "BAD_HTTPS",
        message: `--https must be off, self-signed, tailscale, or files`,
      });
    }
    config.tls.mode = mode;
  }
  if (options.allowConfig !== undefined) {
    config.allowRemoteConfig = options.allowConfig;
  }

  updateBrainConfig(origin.revision, () => config);
  return { type: "single", data: toStatus(config, generatedKey), schema: shareSchema };
}

function hasShareChange(options: ShareOptions): boolean {
  if (options.on || options.off || options.generate) return true;
  return (["bind", "access", "key", "allowConfig", "https"] as const).some(
    (key) => options[key] !== undefined,
  );
}

function selectedAccess(options: ShareOptions, config: BrainConfig): "open" | "key" {
  if (options.key !== undefined && !options.key.trim())
    throw new CommandError({ code: "EMPTY_KEY", message: "A Brain access key cannot be empty" });
  if (options.access) return validateAccess(options.access);
  if (options.key !== undefined || options.generate || options.on || config.auth.mode === "token")
    return "key";
  return "open";
}

export { addShareOptions } from "./options.js";
