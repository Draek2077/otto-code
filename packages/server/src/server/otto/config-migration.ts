// Otto 0.9 wrote settings into config.json that Paseo's strict config schema does
// not know (Otto-only daemon settings, personalities, teams, the OpenAI-compatible
// and Brain providers, git hosting). Paseo rejects the whole file when it finds
// them, so a 0.9 home would stop the daemon from starting.
//
// Before Paseo validates the config, splitOttoConfig() separates what Paseo's
// schema accepts from what it does not. The first time a config needs splitting,
// the original file is kept as config.json.otto-0.9.bak, the Otto-only values
// are merged into otto-config.json (where Otto features read them back), and
// config.json is rewritten with the Paseo part. Nothing is discarded.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { writePrivateFileAtomicSync } from "../private-files.js";
import { ensureOttoHomeSnapshot } from "./home-snapshot.js";
import {
  LocalSttModelIdSchema,
  LocalTtsModelIdSchema,
} from "../speech/providers/local/sherpa/model-catalog.js";

export const OTTO_CONFIG_FILENAME = "otto-config.json";
export const OTTO_CONFIG_BACKUP_FILENAME = "config.json.otto-0.9.bak";

const MAX_SPLIT_PASSES = 20;

type JsonObject = Record<string, unknown>;

export interface OttoConfigSplit {
  paseo: unknown;
  otto: JsonObject;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readAt(root: unknown, segments: PropertyKey[]): unknown {
  let current: unknown = root;
  for (const segment of segments) {
    if (!isObject(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<PropertyKey, unknown>)[segment];
  }
  return current;
}

function setAt(root: JsonObject, segments: string[], value: unknown): void {
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    if (!isObject(current[segment])) current[segment] = {};
    current = current[segment] as JsonObject;
  }
  current[segments[segments.length - 1]] = value;
}

function deleteAt(root: unknown, segments: string[]): void {
  const parent = readAt(root, segments.slice(0, -1));
  if (isObject(parent)) delete parent[segments[segments.length - 1]];
}

// A provider entry is moved as a unit: half a provider definition is useless to
// both Paseo and Otto.
function ownerPath(issuePath: PropertyKey[]): string[] | null {
  const segments = issuePath.filter((segment): segment is string => typeof segment === "string");
  if (segments.length !== issuePath.length || segments.length === 0) return null;
  if (segments[0] === "agents" && segments[1] === "providers" && segments.length >= 3) {
    return segments.slice(0, 3);
  }
  return segments;
}

// Otto 0.9 shipped local speech models Paseo does not (Kokoro v1). The config
// schema accepts any model id, but Paseo's speech runtime rejects unknown ids and
// the daemon exits, so an Otto-only selection moves out and Paseo's default
// applies until Otto's voice models return. A TTS speaker id belongs to its model.
const SPEECH_MODEL_SETTINGS: { path: string[]; schema: z.ZodType; companions?: string[] }[] = [
  { path: ["features", "dictation", "stt", "model"], schema: LocalSttModelIdSchema },
  { path: ["features", "voiceMode", "stt", "model"], schema: LocalSttModelIdSchema },
  {
    path: ["features", "voiceMode", "tts", "model"],
    schema: LocalTtsModelIdSchema,
    companions: ["speakerId"],
  },
];

function moveOttoSpeechModels(paseo: JsonObject, otto: JsonObject): void {
  for (const setting of SPEECH_MODEL_SETTINGS) {
    const value = readAt(paseo, setting.path);
    if (value === undefined || setting.schema.safeParse(value).success) continue;
    const parent = setting.path.slice(0, -1);
    for (const key of [setting.path[setting.path.length - 1], ...(setting.companions ?? [])]) {
      const target = [...parent, key];
      const moved = readAt(paseo, target);
      if (moved === undefined) continue;
      setAt(otto, target, moved);
      deleteAt(paseo, target);
    }
  }
}

// The config paths an issue says belong to Otto rather than Paseo.
function ottoTargetsForIssue(issue: z.core.$ZodIssue): string[][] {
  if (issue.code === "unrecognized_keys") {
    const owner = ownerPath(issue.path);
    if (owner && owner.length < issue.path.length) return [owner];
    const base = issue.path.map(String);
    return issue.keys.map((key) => [...base, key]);
  }
  // Otto's providers (openai-compatible, otto-brain) build on providers Paseo
  // does not ship. Any other invalid value is a real config error.
  if (/unknown provider/i.test(issue.message)) {
    const owner = ownerPath(issue.path);
    if (owner && owner[0] === "agents" && owner[1] === "providers") return [owner];
  }
  return [];
}

export function splitOttoConfig(parsed: unknown, schema: z.ZodType): OttoConfigSplit {
  const otto: JsonObject = {};
  if (!isObject(parsed)) return { paseo: parsed, otto };
  const paseo = structuredClone(parsed);
  moveOttoSpeechModels(paseo, otto);

  for (let pass = 0; pass < MAX_SPLIT_PASSES; pass += 1) {
    const result = schema.safeParse(paseo);
    if (result.success) return { paseo, otto };

    let moved = 0;
    for (const issue of result.error.issues) {
      for (const target of ottoTargetsForIssue(issue)) {
        const value = readAt(paseo, target);
        if (value === undefined) continue;
        setAt(otto, target, value);
        deleteAt(paseo, target);
        moved += 1;
      }
    }
    // Nothing left that Otto can move: the remaining problem is a real Paseo
    // config error, and Paseo's own validation reports it.
    if (moved === 0) return { paseo, otto };
  }
  return { paseo, otto };
}

function mergeMissing(target: JsonObject, source: JsonObject): JsonObject {
  const merged: JsonObject = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (isObject(merged[key]) && isObject(value)) {
      merged[key] = mergeMissing(merged[key] as JsonObject, value);
    } else if (!(key in merged)) {
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * Returns the Paseo part of a parsed config. When Otto-only values are present,
 * persists them to otto-config.json, keeps a one-time backup of the original
 * file, and rewrites config.json without them.
 */
export function migrateOttoConfig(configPath: string, parsed: unknown, schema: z.ZodType): unknown {
  const split = splitOttoConfig(parsed, schema);
  if (Object.keys(split.otto).length === 0) return split.paseo;

  const home = path.dirname(configPath);
  ensureOttoHomeSnapshot(home);
  const backupPath = path.join(home, OTTO_CONFIG_BACKUP_FILENAME);
  if (!existsSync(backupPath)) {
    writePrivateFileAtomicSync(backupPath, readFileSync(configPath));
  }
  const ottoPath = path.join(home, OTTO_CONFIG_FILENAME);
  const existing = existsSync(ottoPath)
    ? (JSON.parse(readFileSync(ottoPath, "utf8")) as JsonObject)
    : {};
  writePrivateFileAtomicSync(
    ottoPath,
    `${JSON.stringify(mergeMissing(existing, split.otto), null, 2)}\n`,
  );
  writePrivateFileAtomicSync(configPath, `${JSON.stringify(split.paseo, null, 2)}\n`);
  return split.paseo;
}
