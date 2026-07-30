/**
 * Downloads a catalog model from Hugging Face into the managed models directory,
 * so `otto brain pull` needs no external tooling. Files land under
 * `<managedModelsDir>/<publisher>/<repo>/<file>` to mirror the LM Studio layout
 * the scanner already understands.
 */
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { CatalogModel } from "../config/schema.js";

const HF_BASE = "https://huggingface.co";

export interface PullProgress {
  file: string;
  receivedBytes: number;
  totalBytes?: number;
}

/** The Hugging Face resolve URL for a repo file on the main branch. */
function resolveUrl(repo: string, file: string): string {
  return `${HF_BASE}/${repo}/resolve/main/${file}`;
}

/**
 * The GGUF filename to download. Prefer an explicit `quantFile`; otherwise the
 * caller must pass one, because community repos name files inconsistently.
 */
function resolveFileName(model: CatalogModel, override?: string): string {
  const file = override ?? model.quantFile;
  if (!file) {
    throw new Error(
      `no file name for ${model.id}: add "quantFile" to the catalog entry or pass --file <name.gguf>`,
    );
  }
  return file;
}

export interface PullOptions {
  model: CatalogModel;
  destRoot: string;
  file?: string;
  onProgress?: (progress: PullProgress) => void;
}

/** Download the model file; returns the local path it was written to. */
export async function pullModel({
  model,
  destRoot,
  file,
  onProgress,
}: PullOptions): Promise<string> {
  const fileName = resolveFileName(model, file);
  const repoDir = path.join(destRoot, model.hfRepo.replace(/\//g, path.sep));
  mkdirSync(repoDir, { recursive: true });
  const destPath = path.join(repoDir, fileName);

  if (existsSync(destPath)) return destPath;

  const url = resolveUrl(model.hfRepo, fileName);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`download failed (${response.status}) for ${url}`);
  }
  const totalBytes = Number(response.headers.get("content-length")) || undefined;
  let receivedBytes = 0;
  const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  body.on("data", (chunk: Buffer) => {
    receivedBytes += chunk.length;
    onProgress?.({ file: fileName, receivedBytes, totalBytes });
  });

  const tmp = `${destPath}.part`;
  await pipeline(body, createWriteStream(tmp));
  const { renameSync } = await import("node:fs");
  renameSync(tmp, destPath);
  return destPath;
}
