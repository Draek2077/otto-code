import type { TerminalManager } from "./terminal-manager.js";
import { createWorkerTerminalManager } from "./worker-terminal-manager.js";

export interface ConfiguredTerminalManagerOptions {
  getOttoPreferences?: () => import("@getpaseo/plugin/otto/terminal").TerminalPreferences; // OTTO(terminal)
  getTerminalActivityUrl?: () => string | null;
}

export function createConfiguredTerminalManager(
  options: ConfiguredTerminalManagerOptions = {},
): TerminalManager {
  return createWorkerTerminalManager(options);
}
