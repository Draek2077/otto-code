/**
 * User-defined model display-name overrides, keyed by model id, persisted at
 * `$OTTO_HOME/otto-brain/rename-map.json`. Kept as its own file (rather than a
 * field on the profiles store) so renaming a model never touches the
 * calibration/profile data profiles.json carries.
 */
import { existsSync, readFileSync } from "node:fs";

import { z } from "zod";

import { resolveBrainPaths, type BrainPaths } from "../config/paths.js";
import { writePrivateFileAtomicSync } from "../config/private-files.js";

const RenameMapSchema = z.record(z.string());

/** Every function here only ever touches renameMapFile; narrowed to that one
 * field (rather than the full BrainPaths) so a test's fake paths object is
 * actually type-checked instead of passing only because tsconfig excludes
 * *.test.ts from the build. */
type RenameMapPaths = Pick<BrainPaths, "renameMapFile">;

export function loadRenameMap(paths: RenameMapPaths = resolveBrainPaths()): Record<string, string> {
  if (!existsSync(paths.renameMapFile)) return {};
  try {
    const parsed = JSON.parse(readFileSync(paths.renameMapFile, "utf8")) as unknown;
    const result = RenameMapSchema.safeParse(parsed);
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

export function saveRenameMap(
  map: Record<string, string>,
  paths: RenameMapPaths = resolveBrainPaths(),
): void {
  writePrivateFileAtomicSync(paths.renameMapFile, `${JSON.stringify(map, null, 2)}\n`);
}

export function updateDisplayName(
  modelId: string,
  displayName: string,
  paths: RenameMapPaths = resolveBrainPaths(),
): Record<string, string> {
  const map = loadRenameMap(paths);
  map[modelId] = displayName;
  saveRenameMap(map, paths);
  return map;
}

export function deleteDisplayName(
  modelId: string,
  paths: RenameMapPaths = resolveBrainPaths(),
): Record<string, string> {
  const map = loadRenameMap(paths);
  delete map[modelId];
  saveRenameMap(map, paths);
  return map;
}
