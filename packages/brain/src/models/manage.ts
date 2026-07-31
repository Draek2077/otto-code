/**
 * Local model management: disk-space accounting and safe deletion. Kept separate
 * from discovery (scan) and download so the destructive path is easy to audit.
 */
import fs from "node:fs";
import path from "node:path";
import { statfs } from "node:fs/promises";

import type { Model } from "../types.js";

// Same shard shape the scanner uses: `-00001-of-00003.gguf`.
const MULTIPART = /-(\d{5})-of-(\d{5})\.gguf$/i;

export interface DiskUsage {
  freeBytes: number;
  totalBytes: number;
}

/** Free and total bytes of the filesystem holding `dir`, or null if unavailable. */
export async function diskUsage(dir: string): Promise<DiskUsage | null> {
  try {
    const s = await statfs(dir);
    return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  } catch {
    return null;
  }
}

/**
 * Total bytes the given models occupy on disk, counting each projector once (a
 * vision repo shares one projector across all its quants, so summing every
 * model's mmprojBytes would over-count).
 */
export function totalModelBytes(models: Model[]): number {
  const seenProjectors = new Set<string>();
  let bytes = 0;
  for (const model of models) {
    bytes += model.sizeBytes;
    if (model.mmprojPath && !seenProjectors.has(model.mmprojPath)) {
      seenProjectors.add(model.mmprojPath);
      bytes += model.mmprojBytes;
    }
  }
  return bytes;
}

export interface DeletePlan {
  files: string[];
  bytes: number;
  includesProjector: boolean;
}

/**
 * Work out exactly which files deleting a model removes: its GGUF (all shards),
 * and the paired projector ONLY when no other quant in the same repo directory
 * still needs it. Never deletes a projector that a sibling quant shares.
 */
export function planDelete(model: Model): DeletePlan {
  const files: string[] = [];
  let bytes = 0;

  const add = (file: string): void => {
    try {
      bytes += fs.statSync(file).size;
      files.push(file);
    } catch {
      /* already gone */
    }
  };

  // The GGUF and its shards.
  const shard = model.modelPath.match(MULTIPART);
  if (shard) {
    const base = model.modelPath.replace(MULTIPART, "");
    const total = Number(shard[2]);
    for (let i = 1; i <= total; i += 1) {
      add(`${base}-${String(i).padStart(5, "0")}-of-${shard[2]}.gguf`);
    }
  } else {
    add(model.modelPath);
  }

  // The projector is shared across the repo's quants; only remove it if this was
  // the last model GGUF in the directory.
  let includesProjector = false;
  if (model.mmprojPath) {
    const dir = path.dirname(model.modelPath);
    const doomed = new Set(files.map((f) => path.resolve(f)));
    let othersRemain = false;
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!name.toLowerCase().endsWith(".gguf")) continue;
        if (/^mmproj/i.test(name)) continue;
        if (doomed.has(path.resolve(dir, name))) continue;
        othersRemain = true;
        break;
      }
    } catch {
      othersRemain = true; // be conservative: keep the projector if unsure
    }
    if (!othersRemain) {
      add(model.mmprojPath);
      includesProjector = true;
    }
  }

  return { files, bytes, includesProjector };
}

/** Delete the files a {@link planDelete} chose, plus a now-empty repo directory. */
export function deleteModelFiles(model: Model): DeletePlan {
  const plan = planDelete(model);
  for (const file of plan.files) {
    fs.rmSync(file, { force: true });
  }
  // Remove the containing directory if we emptied it.
  const dir = path.dirname(model.modelPath);
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    /* not empty or gone */
  }
  return plan;
}
