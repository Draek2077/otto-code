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
import { DEFAULT_RELAY_ENDPOINT } from "@getpaseo/protocol/daemon-endpoints";
import { isOttoLegacyRelayEndpoint } from "@getpaseo/protocol/otto/legacy-relay";
import { writePrivateFileAtomicSync } from "../private-files.js";
import { ensureOttoHomeSnapshot } from "./home-snapshot.js";
import { recoverLegacyApiSpeechModels } from "./speech/legacy-api-recovery.js";
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
    if (!Object.hasOwn(current, segment) || !isObject(current[segment])) {
      Object.defineProperty(current, segment, {
        value: {},
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    current = current[segment] as JsonObject;
  }
  Object.defineProperty(current, segments[segments.length - 1], {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
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
    // OTTO(speech): API model IDs are intentionally free-form, never local catalog entries.
    const parent = setting.path.slice(0, -1);
    const provider = readAt(paseo, [...parent, "provider"]);
    if (provider !== undefined && provider !== "local") continue;
    const value = readAt(paseo, setting.path);
    if (value === undefined || setting.schema.safeParse(value).success) continue;
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
  // Zod deliberately omits this JSON key without reporting an unknown-key issue.
  // Keep it as inert sidecar data rather than losing it on the next config save.
  if (Object.hasOwn(paseo, "__proto__")) {
    setAt(otto, ["__proto__"], paseo["__proto__"]);
    delete paseo["__proto__"];
  }
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
    if (Object.hasOwn(merged, key) && isObject(merged[key]) && isObject(value)) {
      Object.defineProperty(merged, key, {
        value: mergeMissing(merged[key] as JsonObject, value),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } else if (!Object.hasOwn(merged, key)) {
      Object.defineProperty(merged, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  return merged;
}

// COMPAT(ottoLegacyRelay): added in v0.10.0, remove after 2027-04-21 once 0.9 configs have migrated.
function migrateOttoRelay(config: unknown): boolean {
  const relay = readAt(config, ["daemon", "relay"]);
  if (!isObject(relay)) return false;
  const endpointMoved =
    typeof relay.endpoint === "string" && isOttoLegacyRelayEndpoint(relay.endpoint);
  const publicEndpointMoved =
    typeof relay.publicEndpoint === "string" && isOttoLegacyRelayEndpoint(relay.publicEndpoint);
  if (endpointMoved) {
    relay.endpoint = DEFAULT_RELAY_ENDPOINT;
    relay.useTls = true;
    if (relay.publicEndpoint === undefined) relay.publicUseTls = true;
  }
  if (publicEndpointMoved) {
    relay.publicEndpoint = DEFAULT_RELAY_ENDPOINT;
    relay.publicUseTls = true;
  }
  return endpointMoved || publicEndpointMoved;
}

/**
 * Returns the Paseo part of a parsed config. When Otto-only values are present,
 * persists them to otto-config.json, keeps a one-time backup of the original
 * file, and rewrites config.json without them.
 */
// COMPAT(otto09ConfigSplit): added in v0.10.0, remove after 2027-04-21 once 0.9 homes have migrated.
export function migrateOttoConfig(
  configPath: string,
  parsed: unknown,
  schema: z.ZodType,
  persist = true,
): unknown {
  const split = splitOttoConfig(parsed, schema);
  const home = path.dirname(configPath);
  const apiModelsRecovered =
    isObject(split.paseo) &&
    recoverLegacyApiSpeechModels(split.paseo, {
      backup: path.join(home, OTTO_CONFIG_BACKUP_FILENAME),
      preserved: path.join(home, OTTO_CONFIG_FILENAME),
    });
  const relayMoved = migrateOttoRelay(split.paseo);
  const hasOttoSettings = Object.keys(split.otto).length > 0;
  if (!persist) return split.paseo;
  if (!relayMoved && !hasOttoSettings && !apiModelsRecovered) return split.paseo;
  // Let Paseo report malformed configuration without rewriting it first.
  if (!schema.safeParse(split.paseo).success) return split.paseo;

  ensureOttoHomeSnapshot(home);
  const backupPath = path.join(home, OTTO_CONFIG_BACKUP_FILENAME);
  if (!existsSync(backupPath)) {
    writePrivateFileAtomicSync(backupPath, readFileSync(configPath));
  }
  if (hasOttoSettings) {
    const ottoPath = path.join(home, OTTO_CONFIG_FILENAME);
    const existing = existsSync(ottoPath)
      ? (JSON.parse(readFileSync(ottoPath, "utf8")) as JsonObject)
      : {};
    writePrivateFileAtomicSync(
      ottoPath,
      `${JSON.stringify(mergeMissing(existing, split.otto), null, 2)}\n`,
    );
  }
  writePrivateFileAtomicSync(configPath, `${JSON.stringify(split.paseo, null, 2)}\n`);
  return split.paseo;
}
