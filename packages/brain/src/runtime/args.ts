/**
 * Translates a profile into llama-server arguments and builds the PATH the child
 * needs. Runtime-source agnostic: works the same for an LM Studio runtime or a
 * managed one, since both resolve to a `Runtime` (exe + optional vendorDir).
 */
import path from "node:path";

import type { Profile } from "../config/schema.js";
import type { Runtime } from "../types.js";

export interface ServeTarget {
  port: number;
  host?: string;
}

/**
 * PATH value the child process needs so the stub can resolve its DLLs. Both the
 * runtime dir and its vendor dir go first, ahead of the inherited PATH.
 */
export function buildEnv(
  runtime: Runtime,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const parts = [runtime.dir];
  if (runtime.vendorDir) parts.push(runtime.vendorDir);
  return {
    ...baseEnv,
    PATH: `${parts.join(path.delimiter)}${path.delimiter}${baseEnv.PATH || ""}`,
  };
}

/**
 * Translate a profile into llama-server arguments.
 *
 * Only settings that demonstrably matter for stable local inference are emitted -
 * no experimental sampler knobs.
 */
export function buildArgs(profile: Profile, { port, host = "127.0.0.1" }: ServeTarget): string[] {
  const args: string[] = [
    "-m",
    profile.modelPath ?? "",
    "-c",
    String(profile.contextSize),
    "-ctk",
    profile.cacheTypeK,
    "-ctv",
    profile.cacheTypeV,
    "-fa",
    profile.flashAttention ? "on" : "off",
    "-ngl",
    String(profile.gpuLayers),
    "--host",
    host,
    "--port",
    String(port),
    "--no-webui",
  ];

  if (profile.vision && profile.mmprojPath) {
    args.push("--mmproj", profile.mmprojPath);
  }

  // The setting that was actually breaking long agentic runs.
  if (profile.reasoningBudget !== null && profile.reasoningBudget !== undefined) {
    args.push("--reasoning-budget", String(profile.reasoningBudget));
    if (profile.reasoningBudgetMessage) {
      args.push("--reasoning-budget-message", profile.reasoningBudgetMessage);
    }
  }

  if (profile.parallelSlots) args.push("--parallel", String(profile.parallelSlots));
  if (profile.batchSize) args.push("-b", String(profile.batchSize));
  if (profile.ubatchSize) args.push("-ub", String(profile.ubatchSize));
  if (profile.extraArgs && profile.extraArgs.length) args.push(...profile.extraArgs);

  return args;
}

/** The same command as a copy-pasteable shell line, for the TUI to display. */
export function formatCommand(runtime: Runtime, args: string[]): string {
  const quote = (s: string): string => (/\s/.test(s) ? `"${s}"` : s);
  return `${quote(runtime.exe)} ${args.map(quote).join(" ")}`;
}
