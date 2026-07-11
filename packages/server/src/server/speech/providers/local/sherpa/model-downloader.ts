import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type pino from "pino";

import {
  getSherpaOnnxModelSpec,
  type SherpaOnnxModelId,
  type SherpaOnnxModelSpec,
} from "./model-catalog.js";
import { spawnProcess } from "../../../../../utils/spawn.js";

export interface EnsureSherpaOnnxModelOptions {
  modelsDir: string;
  modelId: SherpaOnnxModelId;
  logger: pino.Logger;
}

export function getSherpaOnnxModelDir(modelsDir: string, modelId: SherpaOnnxModelId): string {
  const spec = getSherpaOnnxModelSpec(modelId);
  return path.join(modelsDir, spec.extractedDir);
}

async function hasRequiredFiles(modelDir: string, requiredFiles: string[]): Promise<boolean> {
  const results = await Promise.all(
    requiredFiles.map(async (rel) => {
      const abs = path.join(modelDir, rel);
      try {
        const s = await stat(abs);
        if (s.isDirectory()) {
          return true;
        }
        return s.isFile() && s.size > 0;
      } catch {
        return false;
      }
    }),
  );
  return results.every((present) => present);
}

interface DownloadToFileOptions {
  url: string;
  outputPath: string;
}

async function downloadToFile(options: DownloadToFileOptions): Promise<void> {
  const { url, outputPath } = options;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  if (!res.body) {
    throw new Error(`Failed to download ${url}: missing response body`);
  }

  const tmpPath = `${outputPath}.tmp-${Date.now()}`;
  await mkdir(path.dirname(outputPath), { recursive: true });

  // The fetch ReadableStream type is slightly different from what Readable.fromWeb expects
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeStream = Readable.fromWeb(res.body as any);

  try {
    await pipeline(nodeStream, createWriteStream(tmpPath));
    await rename(tmpPath, outputPath);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

// A bare `tar` on Windows can resolve to Git's MSYS GNU tar (when Git's
// usr\bin precedes System32 on PATH), which parses `C:\...` as a remote
// `host:file` spec and dies with "Cannot connect to C: resolve failed"
// (exit 128). The system bsdtar handles Windows paths and .tar.bz2 natively.
export function resolveTarBinary(): string {
  if (process.platform === "win32") {
    const systemRoot = process.env["SystemRoot"] ?? "C:\\Windows";
    const systemTar = path.join(systemRoot, "System32", "tar.exe");
    if (existsSync(systemTar)) {
      return systemTar;
    }
  }
  return "tar";
}

async function extractTarArchive(archivePath: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess(resolveTarBinary(), ["xf", archivePath, "-C", destDir], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else {
        const detail = stderr.trim().slice(0, 500);
        reject(new Error(`tar exited with code ${code}${detail ? `: ${detail}` : ""}`));
      }
    });
  });
}

async function isNonEmptyFile(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

async function computeFileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

// Refuse to extract an archive whose bytes don't match the pinned digest — the
// guard against a compromised release asset or a MITM'd download. Throws on
// mismatch (the caller deletes the bad archive); warns loudly when no digest is
// pinned yet rather than silently trusting the download.
async function verifyArchiveIntegrity(params: {
  spec: SherpaOnnxModelSpec;
  archivePath: string;
  logger: pino.Logger;
}): Promise<void> {
  const { spec, archivePath, logger } = params;
  if (!spec.sha256) {
    logger.warn(
      { modelId: spec.id },
      "No pinned sha256 for this model; extracting without archive integrity verification",
    );
    return;
  }
  const actual = await computeFileSha256(archivePath);
  if (actual.toLowerCase() !== spec.sha256.toLowerCase()) {
    throw new Error(
      `Model archive ${path.basename(archivePath)} failed integrity verification ` +
        `(expected sha256 ${spec.sha256.toLowerCase()}, got ${actual}).`,
    );
  }
  logger.info({ modelId: spec.id }, "Model archive integrity verified");
}

export async function ensureSherpaOnnxModel(
  options: EnsureSherpaOnnxModelOptions,
): Promise<string> {
  const logger = options.logger.child({
    module: "speech",
    provider: "local",
    component: "model-downloader",
    modelId: options.modelId,
  });

  const spec = getSherpaOnnxModelSpec(options.modelId);
  const modelDir = path.join(options.modelsDir, spec.extractedDir);
  if (await hasRequiredFiles(modelDir, spec.requiredFiles)) {
    return modelDir;
  }

  logger.info({ modelsDir: options.modelsDir }, "Starting model download");

  try {
    const downloadsDir = path.join(options.modelsDir, ".downloads");
    const archiveFilename = path.basename(new URL(spec.archiveUrl).pathname);
    const archivePath = path.join(downloadsDir, archiveFilename);

    if (!(await isNonEmptyFile(archivePath))) {
      await downloadToFile({
        url: spec.archiveUrl,
        outputPath: archivePath,
      });
    }

    try {
      await verifyArchiveIntegrity({ spec, archivePath, logger });

      logger.info(
        {
          modelId: options.modelId,
          archivePath,
          modelDir,
        },
        "Extracting model archive",
      );
      await extractTarArchive(archivePath, options.modelsDir);

      logger.info(
        {
          modelId: options.modelId,
          modelDir,
        },
        "Verifying downloaded model files",
      );
      if (!(await hasRequiredFiles(modelDir, spec.requiredFiles))) {
        throw new Error(
          `Downloaded and extracted ${archiveFilename}, but required files are still missing in ${modelDir}.`,
        );
      }
    } catch (error) {
      // A corrupt, tampered, or incompletely-extracted archive must not wedge the
      // model forever. Drop it so the next attempt re-downloads a fresh copy
      // instead of re-verifying/re-extracting the same bad file.
      await rm(archivePath, { force: true }).catch(() => undefined);
      throw error;
    }

    logger.info(
      {
        modelId: options.modelId,
        archivePath,
      },
      "Finalizing model artifacts",
    );
    try {
      await rm(archivePath, { force: true });
    } catch {
      // ignore
    }

    logger.info({ modelDir }, "Model download completed");
    return modelDir;
  } catch (error) {
    logger.error({ err: error }, "Model download failed");
    throw error;
  }
}

export async function ensureSherpaOnnxModels(options: {
  modelsDir: string;
  modelIds: SherpaOnnxModelId[];
  logger: pino.Logger;
}): Promise<Record<SherpaOnnxModelId, string>> {
  const uniq = Array.from(new Set(options.modelIds));
  const entries: Array<[SherpaOnnxModelId, string]> = await Promise.all(
    uniq.map(async (id) => {
      const modelPath = await ensureSherpaOnnxModel({
        modelsDir: options.modelsDir,
        modelId: id,
        logger: options.logger,
      });
      return [id, modelPath] as [SherpaOnnxModelId, string];
    }),
  );
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return Object.fromEntries(entries) as Record<SherpaOnnxModelId, string>;
}
