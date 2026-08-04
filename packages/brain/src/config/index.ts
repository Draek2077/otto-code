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
  hasStaleCalibration,
} from "./profiles.js";
export {
  calibrationInfo,
  nativeContextLimit,
  profileFieldDescriptors,
  profileWarnings,
  sanitizeProfilePatch,
  formatReasoningBudget,
  CACHE_TYPE_CYCLE,
  REASONING_BUDGET_CYCLE,
  UNRESTRICTED_REASONING_BUDGET,
  type CalibrationInfo,
  type CalibrationState,
  type ProfileFieldDescriptor,
  type ProfileWarning,
} from "./profile-edit.js";
export * from "./schema.js";
