import { readFileSync } from "node:fs";

type ObjectValue = Record<string, unknown>;
function isObject(value: unknown): value is ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function object(value: unknown): ObjectValue {
  return isObject(value) ? value : {};
}
function owner(config: unknown, feature: string, operation: string) {
  return object(object(object(config).features)[feature])[operation];
}
function read(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** COMPAT(ottoApiSpeechQuarantine): added v0.10.0; remove after 2027-04-30.
 * The early clean-baseline migration mistook explicit API IDs for local IDs.
 * Recover a missing API model only when BOTH preserved model and original
 * provider-bearing backup agree. An old local selection is never sent to an API.
 * Mutate only the migration's cloned config; leave both evidence files intact.
 */
export function recoverLegacyApiSpeechModels(
  config: ObjectValue,
  files: { backup: string; preserved: string },
): boolean {
  const paths = [
    ["dictation", "stt"],
    ["voiceMode", "stt"],
    ["voiceMode", "tts"],
  ] as const;
  const missing = paths.filter(([feature, operation]) => {
    const current = object(owner(config, feature, operation));
    return current.provider === "openai" && current.model === undefined;
  });
  if (!missing.length) return false;
  const original = read(files.backup);
  const preserved = read(files.preserved);
  let changed = false;
  for (const [feature, operation] of missing) {
    const prior = object(owner(original, feature, operation));
    const dormant = object(owner(preserved, feature, operation));
    if (
      prior.provider !== "openai" ||
      typeof prior.model !== "string" ||
      !prior.model.trim() ||
      dormant.model !== prior.model
    )
      continue;
    object(owner(config, feature, operation)).model = prior.model;
    changed = true;
  }
  return changed;
}
