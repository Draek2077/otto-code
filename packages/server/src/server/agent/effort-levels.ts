// Effort resolution now lives in the protocol package so the daemon, app, and
// agent personalities all share one implementation (personality effort auto-fill
// in the app pickers resolves the same way the daemon does at spawn). This module
// stays as the daemon-side entry point; importers keep their `./effort-levels.js`
// paths.
export {
  EFFORT_LEVELS as EFFORT_LEVEL_SCALE,
  EffortResolutionError,
  parseEffortLevel,
  resolveEffortOption,
  type EffortLevel,
  type ResolvedEffortOption,
} from "@otto-code/protocol/effort";
