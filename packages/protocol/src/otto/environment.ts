// Otto configuration uses `OTTO_*` environment variables; Paseo source reads
// `PASEO_*`. Each process entry point calls applyOttoEnvironment() before any
// Paseo module reads the environment, so existing Otto setups keep working
// without editing Paseo's readers.
//
// A `PASEO_*` value that is already set wins. Paseo sets those itself for the
// processes it spawns (for example `PASEO_HOME` for an agent's CLI calls), and
// that more specific value must not be overwritten by a user's shell-wide
// `OTTO_*` setting inherited alongside it.

const OTTO_PREFIX = "OTTO_";
const PASEO_PREFIX = "PASEO_";

type MutableEnvironment = Record<string, string | undefined>;

export function applyOttoEnvironment(env: MutableEnvironment): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || !key.startsWith(OTTO_PREFIX)) {
      continue;
    }
    const paseoKey = PASEO_PREFIX + key.slice(OTTO_PREFIX.length);
    if (env[paseoKey] === undefined) {
      env[paseoKey] = value;
    }
  }
}
