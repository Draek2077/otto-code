/** Barrel for the config subsystem: paths, schemas, stores, and profile logic. */
export { resolveOttoHome } from "./otto-home.js";
export { ensurePrivateDirectory, writePrivateFileAtomicSync } from "./private-files.js";
export { resolveBrainPaths, packageRoot, type BrainPaths } from "./paths.js";
export { parseBooleanEnv, applyEnvOverrides } from "./env.js";
export {
  loadBrainConfig,
  loadPersistedConfig,
  saveBrainConfig,
  loadProfilesStore,
  saveProfilesStore,
  loadCatalog,
} from "./store.js";
export {
  defaultProfile,
  forModel,
  put,
  calibrationKey,
  geometryKey,
  getCalibration,
  putCalibration,
} from "./profiles.js";
export * from "./schema.js";
