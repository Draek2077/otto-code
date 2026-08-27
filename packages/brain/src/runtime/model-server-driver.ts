/**
 * The narrow, observed seam between the Brain host and a model-server engine.
 *
 * This intentionally starts with launch and introspection only. A method joins
 * this contract when the common host needs the behavior from more than one
 * driver; naming every current llama.cpp flag as a generic operation would
 * create a false lowest common denominator before a second engine exists.
 */
import path from "node:path";
import { mkdirSync } from "node:fs";

import type { Calibration, Profile } from "../config/schema.js";
import type { BrainPaths } from "../config/paths.js";
import type { Model, Runtime } from "../types.js";
import { buildArgs, buildEnv, formatCommand } from "./args.js";
import { formatLlamaServerLog } from "../service/log-format.js";

export interface ModelServerLaunch {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  command: string;
  readinessPath: string;
  propertiesPath: string | null;
  formatLogLine(line: string): string;
}

export interface ModelServerDriverLaunchInput {
  runtime: Runtime;
  model: Model;
  profile: Profile;
  calibration: Calibration | null;
  paths: BrainPaths;
  host: string;
  port: number;
  logVerbosity: number;
}

/**
 * Driver mechanics live here; the host owns process supervision, security,
 * scheduler admission, status events, and the stable public endpoint.
 */
export interface ModelServerRuntimeDriver {
  readonly id: string;
  readonly displayName: string;
  /** Native process name for engine-originated diagnostics. */
  readonly processName: string;
  describeProcessExit(input: { code: number | null; signal: NodeJS.Signals | null }): string;
  describeLaunchError(error: Error): string;
  createLaunch(input: ModelServerDriverLaunchInput): ModelServerLaunch;
}

/** The first driver preserves the existing managed llama.cpp launch exactly. */
export const llamaCppRuntimeDriver: ModelServerRuntimeDriver = {
  id: "llama.cpp",
  displayName: "llama.cpp",
  processName: "llama-server",

  describeProcessExit({ code, signal }) {
    // 3221225781 == 0xC0000135 STATUS_DLL_NOT_FOUND: the vendor DLL trap.
    const hint =
      code === 3221225781 ? " (missing runtime DLLs - the vendor directory was not on PATH)" : "";
    return `llama-server exited with code ${code}${signal ? ` signal ${signal}` : ""}${hint}`;
  },

  describeLaunchError(error) {
    return `could not launch llama-server: ${error.message}`;
  },

  createLaunch({ runtime, model, profile, calibration, paths, host, port, logVerbosity }) {
    // llama.cpp enables scheduler-required slot erasure only when this existing
    // directory is passed at launch. Failure to create it preserves the old
    // behavior rather than making model startup fail for a cleanup feature.
    const slotSavePath = path.join(paths.root, "slot-saves");
    try {
      mkdirSync(slotSavePath, { recursive: true });
    } catch {
      /* launch without native slot actions */
    }

    const args = buildArgs(
      { ...profile, modelPath: model.modelPath, mmprojPath: model.mmprojPath },
      { port, host, logVerbosity, slotSavePath },
      model,
      calibration,
    );
    return {
      executable: runtime.exe,
      args,
      cwd: runtime.dir,
      env: buildEnv(runtime),
      command: formatCommand(runtime, args),
      readinessPath: "/health",
      propertiesPath: "/props",
      formatLogLine: formatLlamaServerLog,
    };
  },
};
