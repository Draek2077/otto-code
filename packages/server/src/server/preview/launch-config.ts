import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";

/**
 * `.claude/launch.json` — the project-level dev-server launch config shared
 * with Claude Code's preview tooling. Otto's preview subsystem reads the same
 * file so one config drives both harnesses.
 * See docs/preview.md ("launch.json").
 */

export const LAUNCH_CONFIG_RELATIVE_PATH = path.join(".claude", "launch.json");

const LaunchConfigurationSchema = z.object({
  name: z.string().min(1),
  runtimeExecutable: z.string().min(1),
  runtimeArgs: z.array(z.string()).default([]),
  port: z.number().int().min(1).max(65_535),
  env: z.record(z.string(), z.string()).optional(),
});

const LaunchConfigSchema = z.object({
  version: z.string().optional(),
  configurations: z.array(LaunchConfigurationSchema),
});

export type LaunchConfiguration = z.infer<typeof LaunchConfigurationSchema>;
export type LaunchConfig = z.infer<typeof LaunchConfigSchema>;

export class LaunchConfigError extends Error {
  constructor(
    message: string,
    public readonly configPath: string,
  ) {
    super(message);
    this.name = "LaunchConfigError";
  }
}

export function resolveLaunchConfigPath(cwd: string): string {
  return path.join(cwd, LAUNCH_CONFIG_RELATIVE_PATH);
}

/** Returns null when the file does not exist; throws LaunchConfigError when it is invalid. */
export async function readLaunchConfig(cwd: string): Promise<LaunchConfig | null> {
  const configPath = resolveLaunchConfigPath(cwd);
  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw new LaunchConfigError(
      `Cannot read ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
      configPath,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new LaunchConfigError(
      `${configPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      configPath,
    );
  }

  const result = LaunchConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new LaunchConfigError(
      `${configPath} does not match the launch config format: ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
      configPath,
    );
  }
  return result.data;
}

export function findLaunchConfiguration(
  config: LaunchConfig,
  name: string,
): LaunchConfiguration | undefined {
  return config.configurations.find((entry) => entry.name === name);
}
