import type { z } from "zod";
import { isProtectedOttoStorageKey } from "./storage-continuity";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// COMPAT(otto09PersistedFields): added in v0.10.0; review after 2027-04-21.
// Strict Paseo runtime schemas still validate every supported value. Only unknown
// object fields are projected out of existing Otto persistence, never wire data.
export function parseOttoPersistedState<T>(name: string, value: unknown, schema: z.ZodType<T>) {
  let result = schema.safeParse(value);
  if (result.success || !isProtectedOttoStorageKey(name) || !record(value)) return result;
  const projected: unknown = JSON.parse(JSON.stringify(value));
  for (let pass = 0; pass < 32 && !result.success; pass++) {
    let changed = false;
    for (const issue of result.error.issues) {
      if (issue.code !== "unrecognized_keys") continue;
      let target: unknown = projected;
      for (const key of issue.path) {
        if ((record(target) || Array.isArray(target)) && Object.hasOwn(target, key)) {
          target = Reflect.get(target, key);
        } else {
          target = null;
          break;
        }
      }
      if (!record(target)) continue;
      for (const key of issue.keys) {
        if (Object.hasOwn(target, key)) {
          delete target[key];
          changed = true;
        }
      }
    }
    if (!changed) break;
    result = schema.safeParse(projected);
  }
  return result;
}

function mergeUnknownFields(previous: unknown, projected: unknown, next: unknown): unknown {
  if (record(previous) && record(projected) && record(next)) {
    return Object.fromEntries([
      ...Object.entries(previous).filter(([key]) => !Object.hasOwn(projected, key)),
      ...Object.entries(next).map(([key, value]) => [
        key,
        mergeUnknownFields(previous[key], projected[key], value),
      ]),
    ]);
  }
  if (Array.isArray(previous) && Array.isArray(projected) && Array.isArray(next)) {
    return next.map((value) => {
      if (!record(value)) return value;
      const idKey = ["id", "browserId", "agentId", "workspaceId", "serverId"].find(
        (key) => typeof value[key] === "string",
      );
      if (!idKey) return value;
      return mergeUnknownFields(
        previous.find((item) => record(item) && item[idKey] === value[idKey]),
        projected.find((item) => record(item) && item[idKey] === value[idKey]),
        value,
      );
    });
  }
  return next;
}

export function serializeOttoPersistedState<T>(
  name: string,
  previousRaw: string | null,
  next: unknown,
  schema: z.ZodType<T>,
): string {
  if (previousRaw !== null && isProtectedOttoStorageKey(name)) {
    try {
      const previous: unknown = JSON.parse(previousRaw);
      const projected = parseOttoPersistedState(name, previous, schema);
      if (projected.success)
        return JSON.stringify(mergeUnknownFields(previous, projected.data, next));
    } catch {
      /* Malformed originals remain in the private recovery copy. */
    }
  }
  return JSON.stringify(next);
}
