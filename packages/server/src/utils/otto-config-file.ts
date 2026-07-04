import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  OttoConfigRawSchema,
  type OttoConfigRaw,
  type OttoConfigRevision,
  type ProjectConfigRpcError,
} from "@otto-code/protocol/otto-config-schema";
export {
  OttoConfigRevisionSchema,
  ProjectConfigRpcErrorSchema,
  type OttoConfigRevision,
  type ProjectConfigRpcError,
} from "@otto-code/protocol/otto-config-schema";

export const OTTO_CONFIG_FILE_NAME = "otto.json";

export type ReadOttoConfigForEditResult =
  | { ok: true; config: OttoConfigRaw | null; revision: OttoConfigRevision | null }
  | { ok: false; error: ProjectConfigRpcError };

export type WriteOttoConfigForEditResult =
  | { ok: true; config: OttoConfigRaw; revision: OttoConfigRevision }
  | { ok: false; error: ProjectConfigRpcError };

export interface WriteOttoConfigForEditInput {
  repoRoot: string;
  config: OttoConfigRaw;
  expectedRevision: OttoConfigRevision | null;
}

export function resolveOttoConfigPath(repoRoot: string): string {
  return join(repoRoot, OTTO_CONFIG_FILE_NAME);
}

export function statOttoConfigPath(repoRoot: string): OttoConfigRevision | null {
  const configPath = resolveOttoConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  const stats = statSync(configPath);
  return {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

export function readOttoConfigJson(repoRoot: string): unknown {
  const configPath = resolveOttoConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  return JSON.parse(readFileSync(configPath, "utf8"));
}

export function readOttoConfigForEdit(repoRoot: string): ReadOttoConfigForEditResult {
  try {
    const json = readOttoConfigJson(repoRoot);
    if (json === null) {
      return { ok: true, config: null, revision: null };
    }
    return {
      ok: true,
      config: OttoConfigRawSchema.parse(json),
      revision: statOttoConfigPath(repoRoot),
    };
  } catch {
    return {
      ok: false,
      error: { code: "invalid_project_config" },
    };
  }
}

export function writeOttoConfigForEdit(
  input: WriteOttoConfigForEditInput,
): WriteOttoConfigForEditResult {
  const parsed = OttoConfigRawSchema.safeParse(input.config);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_project_config" } };
  }

  const configPath = resolveOttoConfigPath(input.repoRoot);
  const tempPath = join(
    input.repoRoot,
    `.${OTTO_CONFIG_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    writeFileSync(tempPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
    const currentRevision = statOttoConfigPath(input.repoRoot);
    if (!ottoConfigRevisionsEqual(currentRevision, input.expectedRevision)) {
      removeTempOttoConfig(tempPath);
      return {
        ok: false,
        error: { code: "stale_project_config", currentRevision },
      };
    }

    renameSync(tempPath, configPath);
    const revision = statOttoConfigPath(input.repoRoot);
    if (!revision) {
      return { ok: false, error: { code: "write_failed" } };
    }
    return { ok: true, config: parsed.data, revision };
  } catch {
    removeTempOttoConfig(tempPath);
    return { ok: false, error: { code: "write_failed" } };
  }
}

function ottoConfigRevisionsEqual(
  left: OttoConfigRevision | null,
  right: OttoConfigRevision | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.mtimeMs === right.mtimeMs && left.size === right.size;
}

function removeTempOttoConfig(tempPath: string): void {
  try {
    rmSync(tempPath, { force: true });
  } catch {
    // Best-effort cleanup only; callers need the original write outcome.
  }
}
