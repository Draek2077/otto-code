/** One sharing policy for standalone files and local/Remote owning hosts. */
import type { BrainConfig } from "../config/schema.js";
import { CommandError } from "../output/types.js";
import type { ShareOptions, ShareStatus } from "./share-contract.js";

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost" || host === "";
}
export function sharingStatus(config: BrainConfig, generatedKey: string | null): ShareStatus {
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
export function hasShareChange(options: ShareOptions): boolean {
  if (options.on || options.off || options.generate) return true;
  return (["bind", "access", "key", "allowConfig", "https"] as const).some(
    (key) => options[key] !== undefined,
  );
}
function selectedAccess(options: ShareOptions, config: BrainConfig): "open" | "key" {
  if (options.key !== undefined && (!options.key.trim() || options.key === "********"))
    throw new CommandError({
      code: "EMPTY_KEY",
      message: "Use a nonblank access key, never a redacted placeholder",
    });
  if (options.access) {
    if (options.access !== "open" && options.access !== "key")
      throw new CommandError({ code: "BAD_ACCESS", message: '--access must be "open" or "key"' });
    return options.access;
  }
  if (options.key !== undefined || options.generate || options.on || config.auth.mode === "token")
    return "key";
  return "open";
}
function selectedTls(mode: string): BrainConfig["tls"]["mode"] {
  if (mode !== "off" && mode !== "self-signed" && mode !== "tailscale" && mode !== "files")
    throw new CommandError({
      code: "BAD_HTTPS",
      message: "--https must be off, self-signed, tailscale, or files",
    });
  return mode;
}
export interface SharePolicyPorts {
  tailnetAvailable(): Promise<boolean>;
  generateKey(): string;
  hasAccessKey?: boolean;
}
export async function prepareSharing(
  origin: BrainConfig,
  options: ShareOptions,
  ports: SharePolicyPorts,
) {
  const config = structuredClone(origin);
  if (!hasShareChange(options)) return { config, key: null, changed: false };
  if (options.off) {
    config.listen.host = "127.0.0.1";
    config.auth.mode = "none";
    config.allowInsecureBind = false;
    config.allowRemoteConfig = false;
    return { config, key: null, changed: true };
  }
  if (options.bind !== undefined) {
    config.listen.host = options.bind === "all" ? "0.0.0.0" : options.bind;
  } else if (options.on && isLoopback(config.listen.host)) {
    config.listen.host = (await ports.tailnetAvailable()) ? "tailscale" : "0.0.0.0";
  }
  const access = selectedAccess(options, config);
  let key: string | null = null;
  if (access === "open") {
    config.auth.mode = "none";
    config.allowInsecureBind = true;
  } else {
    config.auth.mode = "token";
    config.allowInsecureBind = false;
    if (options.key !== undefined) config.auth.token = options.key;
    else if (options.generate || !(ports.hasAccessKey ?? Boolean(config.auth.token))) {
      key = ports.generateKey();
      config.auth.token = key;
    }
  }
  if (options.https !== undefined) config.tls.mode = selectedTls(options.https);
  if (options.allowConfig !== undefined) config.allowRemoteConfig = options.allowConfig;
  return { config, key, changed: true };
}
