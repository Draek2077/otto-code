import type { BrainConfig } from "./schema.js";

/** Shared HTTP/CLI presentation. Persistence always receives the original values. */
export function redactBrainConfig(config: BrainConfig): BrainConfig {
  return {
    ...config,
    auth: { ...config.auth, token: config.auth.token ? "********" : null },
    hfToken: config.hfToken ? "********" : null,
  };
}
