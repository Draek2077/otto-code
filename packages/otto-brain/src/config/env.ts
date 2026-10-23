/**
 * Env-var overrides layered over persisted config, matching Otto's precedence
 * (CLI → env → file → default). The brain keeps its own `OTTO_BRAIN_*` namespace
 * (like `OTTO_RELAY_*`), plus it honors `OTTO_HOME` via the path resolver.
 * Overrides are applied in memory only; they are never written back to the file.
 */
import type { BrainConfig } from "./schema.js";

const TRUE = new Set(["1", "true", "yes", "on"]);
const FALSE = new Set(["0", "false", "no", "off"]);

export function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (TRUE.has(v)) return true;
  if (FALSE.has(v)) return false;
  return undefined;
}

export function applyEnvOverrides(config: BrainConfig, env: NodeJS.ProcessEnv): BrainConfig {
  const next: BrainConfig = {
    ...config,
    listen: { ...config.listen },
    auth: { ...config.auth },
    tls: { ...config.tls },
    runtime: { ...config.runtime },
    defaults: { ...config.defaults },
  };

  const enabled = parseBooleanEnv(env.OTTO_BRAIN_ENABLED);
  if (enabled !== undefined) next.enabled = enabled;

  const autoStart = parseBooleanEnv(env.OTTO_BRAIN_AUTOSTART);
  if (autoStart !== undefined) next.autoStart = autoStart;

  if (env.OTTO_BRAIN_LISTEN) next.listen.host = env.OTTO_BRAIN_LISTEN;
  if (env.OTTO_BRAIN_PORT) {
    const port = Number(env.OTTO_BRAIN_PORT);
    if (Number.isFinite(port)) next.listen.port = port;
  }

  if (env.OTTO_BRAIN_TOKEN) {
    next.auth = { mode: "token", token: env.OTTO_BRAIN_TOKEN };
  }

  // Back-compat: the old runtime override env var points at a runtime directory.
  if (env.OTTO_BRAIN_LLAMA_SERVER) {
    next.runtime = { ...next.runtime, path: env.OTTO_BRAIN_LLAMA_SERVER };
  }
  if (env.OTTO_BRAIN_MODELS_DIR) next.modelsDir = env.OTTO_BRAIN_MODELS_DIR;
  if (env.OTTO_BRAIN_MODEL) next.defaultModel = env.OTTO_BRAIN_MODEL;

  return next;
}
