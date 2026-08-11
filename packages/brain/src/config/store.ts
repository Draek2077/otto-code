/**
 * Load/save for otto-brain's persisted state under `$OTTO_HOME/otto-brain/`.
 * Reads are validated through the zod schemas; writes are atomic + private. On
 * first run, profiles and the download catalog are migrated once from the legacy
 * repo-local `config/` seed data so an existing calibrated setup is not lost.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { z } from "zod";

import { writePrivateFileAtomicSync } from "./private-files.js";
import { packageRoot, resolveBrainPaths, type BrainPaths } from "./paths.js";
import {
  BrainConfigSchema,
  CatalogSchema,
  ProfilesStoreSchema,
  type BrainConfig,
  type Catalog,
  type ProfilesStore,
} from "./schema.js";
import { applyEnvOverrides } from "./env.js";

function readJson<S extends z.ZodTypeAny>(file: string, schema: S): z.infer<S> | null {
  if (!existsSync(file)) return null;
  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `invalid ${path.basename(file)}: ${result.error.issues[0]?.message ?? "schema error"}`,
    );
  }
  return result.data as z.infer<S>;
}

function writeJson(file: string, data: unknown): void {
  writePrivateFileAtomicSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

// ------------------------------------------------------------------- profiles

export function loadProfilesStore(paths: BrainPaths = resolveBrainPaths()): ProfilesStore {
  const current = readJson(paths.profilesFile, ProfilesStoreSchema);
  if (current) return current;

  const legacy = path.join(packageRoot(), "config", "profiles.json");
  const migrated = readJson(legacy, ProfilesStoreSchema);
  if (migrated) {
    writeJson(paths.profilesFile, migrated);
    return migrated;
  }
  return ProfilesStoreSchema.parse({});
}

export function saveProfilesStore(
  store: ProfilesStore,
  paths: BrainPaths = resolveBrainPaths(),
): void {
  writeJson(paths.profilesFile, store);
}

// -------------------------------------------------------------------- catalog

export function loadCatalog(paths: BrainPaths = resolveBrainPaths()): Catalog {
  const current = readJson(paths.catalogFile, CatalogSchema);
  if (current) {
    // Curated entries are Otto-owned product copy. Replace every entry whose
    // stable download id ships in the seed so catalog corrections reach every
    // existing Brain home after an upgrade. Keep entries with unknown ids: they
    // are the only user-owned catalog records and must survive product updates.
    //
    // Do not merge field-by-field. A partial merge leaves old names or stale
    // descriptions behind indefinitely, which is precisely what a catalog
    // migration is meant to prevent.
    const legacy = readJson(path.join(packageRoot(), "config", "downloads.json"), CatalogSchema);
    if (!legacy) return current;
    const seedIds = new Set(legacy.models.map((model) => model.id));
    // A source repository can change while the underlying curated model stays
    // the same. Those retired ids are product-owned too: drop them rather than
    // displaying an obsolete duplicate beside its canonical replacement.
    const retiredSeedIds = new Set(legacy.models.flatMap((model) => model.replaces ?? []));
    const userModels = current.models.filter(
      (model) => !seedIds.has(model.id) && !retiredSeedIds.has(model.id),
    );
    const models = [...legacy.models, ...userModels];
    const changed = JSON.stringify(models) !== JSON.stringify(current.models);
    if (!changed) return current;
    const merged = { ...current, models };
    writeJson(paths.catalogFile, merged);
    return merged;
  }

  const legacy = path.join(packageRoot(), "config", "downloads.json");
  const migrated = readJson(legacy, CatalogSchema);
  if (migrated) {
    writeJson(paths.catalogFile, migrated);
    return migrated;
  }
  return CatalogSchema.parse({ models: [] });
}

// --------------------------------------------------------------------- config

/** Persisted config only - no env overrides. Used by writers. */
export function loadPersistedConfig(paths: BrainPaths = resolveBrainPaths()): BrainConfig {
  const current = readJson(paths.configFile, BrainConfigSchema);
  if (current) return current;
  const seeded = BrainConfigSchema.parse({});
  writeJson(paths.configFile, seeded);
  return seeded;
}

/** Effective config: persisted file with env overrides layered on top. */
export function loadBrainConfig(
  env: NodeJS.ProcessEnv = process.env,
  paths: BrainPaths = resolveBrainPaths(env),
): BrainConfig {
  return applyEnvOverrides(loadPersistedConfig(paths), env);
}

export function saveBrainConfig(
  config: BrainConfig,
  paths: BrainPaths = resolveBrainPaths(),
): void {
  const validated = BrainConfigSchema.parse(config);
  writeJson(paths.configFile, validated);
}
