/**
 * Build a catalog of hostable models from disk. Weight files and their vision
 * projectors live side by side in the same directory, so a projector found next
 * to a model is paired with it. Ported from the original models.js; the models
 * directory is now configurable (managed dir ∪ LM Studio) instead of hardcoded.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as gguf from "../gguf.js";
import type { Model, ModelFeatures, ModelMetadata } from "../types.js";

export const LMSTUDIO_MODELS_DIR = path.join(os.homedir(), ".lmstudio", "models");

// The quant is the terminal GGUF filename suffix, optionally preceded by a
// source-defined qualifier such as Muse's `UD-`. Matching a known substring
// truncates newer labels (for example Q2_K_XL -> Q2_K) and misses them when
// their exact spelling is not in a hard-coded list.
const QUANT_SUFFIX =
  /(?:^|[-_])((?:UD-)?(?:IQ[1-4]|Q[2-8])(?:_[A-Z0-9]+)*|NVFP\d+|MXFP\d+|BF16|F16|F32)(?:-(?:MTP|IMATRIX|DISTILL))?(?:-\d{5}-OF-\d{5})?\.GGUF$/i;

const MULTIPART = /-(\d{5})-of-(\d{5})\.gguf$/i;

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".gguf")) out.push(full);
  }
  return out;
}

export function detectQuant(filename: string): string | null {
  const match = path.basename(filename).match(QUANT_SUFFIX);
  // `UD-` is a source filename qualifier, not part of the user-facing quant.
  return match?.[1]?.replace(/^UD-/i, "").toUpperCase() ?? null;
}

export function isProjectorFile(filename: string): boolean {
  return /^mmproj/i.test(path.basename(filename));
}

/** Feature flags inferred from the filename, since these are community builds. */
function detectFeatures(filename: string): ModelFeatures {
  const upper = path.basename(filename).toUpperCase();
  return {
    mtp: /\bMTP\b/.test(upper) || upper.includes("-MTP"),
    imatrix: upper.includes("IMATRIX"),
    distilled: upper.includes("DISTILL"),
  };
}

export interface ScanOptions {
  modelsDir?: string;
  withMetadata?: boolean;
  origin?: "managed" | "lmstudio";
}

export function scan({
  modelsDir = LMSTUDIO_MODELS_DIR,
  withMetadata = true,
  origin,
}: ScanOptions = {}): Model[] {
  const files = walk(modelsDir);

  const projectorsByDir = new Map<string, { file: string; size: number }>();
  const weightFiles: string[] = [];

  for (const file of files) {
    if (isProjectorFile(file)) {
      const dir = path.dirname(file);
      // Prefer the largest projector if a repo ships several precisions.
      const existing = projectorsByDir.get(dir);
      const size = fs.statSync(file).size;
      if (!existing || size > existing.size) projectorsByDir.set(dir, { file, size });
      continue;
    }
    const parts = file.match(MULTIPART);
    // For sharded models only the first shard is passed to llama-server.
    if (parts && parts[1] !== "00001") continue;
    weightFiles.push(file);
  }

  const models: Model[] = [];
  for (const file of weightFiles) {
    const dir = path.dirname(file);
    const stat = fs.statSync(file);
    let sizeBytes = stat.size;

    // Sum shards so the VRAM estimate reflects the whole model.
    const shard = file.match(MULTIPART);
    if (shard) {
      const total = Number(shard[2]);
      const base = file.replace(MULTIPART, "");
      for (let i = 2; i <= total; i += 1) {
        const part = `${base}-${String(i).padStart(5, "0")}-of-${shard[2]}.gguf`;
        try {
          sizeBytes += fs.statSync(part).size;
        } catch {
          /* missing shard: reported by validate() */
        }
      }
    }

    const projector = projectorsByDir.get(dir) || null;
    const entry: Model = {
      id: path.relative(modelsDir, file).replace(/\\/g, "/"),
      displayName: path.basename(file, ".gguf"),
      publisher: path.relative(modelsDir, dir).split(path.sep)[0] || null,
      dir,
      modelPath: file,
      sizeBytes,
      sharded: Boolean(shard),
      quant: detectQuant(path.basename(file)),
      features: detectFeatures(file),
      mmprojPath: projector ? projector.file : null,
      mmprojBytes: projector ? projector.size : 0,
      metadata: null,
      metadataError: null,
      origin,
    };

    if (withMetadata) {
      try {
        entry.metadata = gguf.summarize(file) as unknown as ModelMetadata;
      } catch (error) {
        entry.metadataError = error instanceof Error ? error.message : String(error);
      }
    }

    models.push(entry);
  }

  models.sort((a, b) => a.displayName.localeCompare(b.displayName));
  qualifyDuplicateNames(models);
  return models;
}

/**
 * Several publishers ship identically-named quants; qualify the duplicates so the
 * picker never shows two indistinguishable rows.
 */
function qualifyDuplicateNames(models: Model[]): void {
  const byName = new Map<string, Model[]>();
  for (const model of models) {
    const list = byName.get(model.displayName) || [];
    list.push(model);
    byName.set(model.displayName, list);
  }
  for (const [, group] of byName) {
    if (group.length < 2) continue;
    for (const model of group) {
      if (model.publisher) model.displayName = `${model.displayName} (${model.publisher})`;
    }
  }
}

/** Human-readable size. */
export function formatBytes(bytes: number): string {
  if (!bytes) return "0";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i >= 3 ? 2 : 0)} ${units[i]}`;
}
