const OTTO_NODE_ENV = "OTTO_NODE_ENV";
const ELECTRON_RUN_AS_NODE = "ELECTRON_RUN_AS_NODE";

const RUNTIME_CONTROL_ENV_KEYS = [
  OTTO_NODE_ENV,
  "OTTO_DESKTOP_MANAGED",
  "OTTO_SUPERVISED",
  ELECTRON_RUN_AS_NODE,
  "ELECTRON_NO_ATTACH_CONSOLE",
] as const;

export type OttoNodeEnv = "development" | "production" | "test";
export type ProcessEnvRecord = Record<string, string | undefined>;
export type ExternalProcessEnv = NodeJS.ProcessEnv & Record<string, string>;

function buildInternalProcessEnv<T extends ProcessEnvRecord>(baseEnv: T): T {
  return { ...baseEnv };
}

function buildExternalProcessEnv(
  baseEnv: ProcessEnvRecord,
  overlays: ProcessEnvRecord[],
): ExternalProcessEnv {
  const sanitized = Object.assign({}, baseEnv, ...overlays);
  for (const key of RUNTIME_CONTROL_ENV_KEYS) {
    delete sanitized[key];
  }
  for (const [key, value] of Object.entries(sanitized)) {
    if (value === undefined) {
      delete sanitized[key];
    }
  }
  return sanitized as ExternalProcessEnv;
}

export function createOttoInternalEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return buildInternalProcessEnv(baseEnv);
}

export function createExternalProcessEnv(
  baseEnv: ProcessEnvRecord,
  ...overlays: ProcessEnvRecord[]
): ExternalProcessEnv {
  return buildExternalProcessEnv(baseEnv, overlays);
}

export function createExternalCommandProcessEnv(
  _command: string,
  baseEnv: ProcessEnvRecord,
  ...overlays: ProcessEnvRecord[]
): ExternalProcessEnv {
  // Deprecated command parameter: retained while callers migrate to createExternalProcessEnv.
  return buildExternalProcessEnv(baseEnv, overlays);
}

export function buildSelfNodeCommand(
  args: string[],
  envOverlay?: ProcessEnvRecord,
): {
  command: string;
  args: string[];
  env: ExternalProcessEnv;
} {
  const env = buildExternalProcessEnv(process.env, []);
  Object.assign(env, { [ELECTRON_RUN_AS_NODE]: "1" }, envOverlay);
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete env[key];
    }
  }
  return {
    command: process.execPath,
    args,
    env,
  };
}

export function resolveOttoNodeEnv(env: NodeJS.ProcessEnv): OttoNodeEnv | undefined {
  const value = env[OTTO_NODE_ENV];
  return value === "development" || value === "production" || value === "test" ? value : undefined;
}
