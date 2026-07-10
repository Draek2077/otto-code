import { promises as fs } from "node:fs";
import { extractSymbols, getParserForFile, type CodeSymbol } from "@otto-code/highlight";
import { readExplorerFile } from "./service.js";
import { walkWorkspaceFiles } from "./gitignore.js";
import { expandUserPath } from "../path-utils.js";

// ctags-style navigation index. Two daemon-side services:
//   - a gitignore-aware file listing for the fuzzy finder (client-side match);
//   - a name → definition-locations map built by walking the same Lezer trees
//     the highlighter uses, cached per workspace and rebuilt on demand.
// Honest and name-based: no type resolution, so multiple hits are a picker,
// not a guess.

const MAX_LISTED_FILES = 20_000;
const MAX_INDEXED_FILES = 5_000;
const MAX_INDEXED_FILE_BYTES = 1_000_000;
const INDEX_TTL_MS = 30_000;

export interface CodeSymbolLocation extends CodeSymbol {
  path: string;
}

export async function listWorkspaceFiles(
  root: string,
): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  const truncated = await walkWorkspaceFiles(expandUserPath(root), {
    fileLimit: MAX_LISTED_FILES,
    onFile: ({ relPath }) => {
      files.push(relPath);
    },
  });
  files.sort();
  return { files, truncated };
}

/**
 * Outline for one file: parse the current buffer and extract definitions.
 * Cheap enough to run per-request; no caching needed.
 */
export async function getFileOutline(
  root: string,
  relativePath: string,
): Promise<CodeSymbolLocation[]> {
  const file = await readExplorerFile({ root, relativePath });
  if (file.kind !== "text" || typeof file.content !== "string") {
    return [];
  }
  return extractSymbols(file.content, file.path).map((symbol) => ({
    name: symbol.name,
    kind: symbol.kind,
    line: symbol.line,
    column: symbol.column,
    path: file.path,
  }));
}

interface CachedIndex {
  builtAt: number;
  building: Promise<Map<string, CodeSymbolLocation[]>> | null;
  byName: Map<string, CodeSymbolLocation[]>;
}

/**
 * Per-workspace symbol index. Lazily built and cached with a short TTL; an
 * explicit `invalidate(root)` (fired on writes into that workspace) forces the
 * next lookup to rebuild. A full rebuild is a bounded gitignore-aware walk —
 * acceptable for v1 since lookups are user-initiated, not per-keystroke.
 */
export class WorkspaceSymbolIndex {
  private readonly caches = new Map<string, CachedIndex>();
  // Bumped by every invalidate; a build stamps the generation it started under
  // and refuses to cache if an invalidation raced it, so a write during an
  // in-flight build is never lost to a stale rebuild.
  private readonly generations = new Map<string, number>();

  invalidate(root: string): void {
    const key = expandUserPath(root);
    this.caches.delete(key);
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
  }

  async findSymbol(root: string, name: string): Promise<CodeSymbolLocation[]> {
    const index = await this.ensureIndex(expandUserPath(root));
    return index.get(name) ?? [];
  }

  private async ensureIndex(root: string): Promise<Map<string, CodeSymbolLocation[]>> {
    const cached = this.caches.get(root);
    const now = Date.now();
    if (cached && !cached.building && now - cached.builtAt < INDEX_TTL_MS) {
      return cached.byName;
    }
    if (cached?.building) {
      return cached.building;
    }
    const generation = this.generations.get(root) ?? 0;
    const building = this.buildIndex(root);
    this.caches.set(root, {
      builtAt: now,
      building,
      byName: cached?.byName ?? new Map(),
    });
    const byName = await building;
    // Only cache the result if no invalidation landed while we were building;
    // otherwise the map reflects pre-write disk state and must not stick (a
    // racing invalidate already dropped the cache entry, so the next lookup
    // rebuilds against fresh disk state).
    if ((this.generations.get(root) ?? 0) === generation) {
      this.caches.set(root, { builtAt: Date.now(), building: null, byName });
    }
    return byName;
  }

  private async buildIndex(root: string): Promise<Map<string, CodeSymbolLocation[]>> {
    const byName = new Map<string, CodeSymbolLocation[]>();
    await walkWorkspaceFiles(root, {
      fileLimit: MAX_INDEXED_FILES,
      onFile: async ({ absPath, relPath }) => {
        if (!getParserForFile(relPath)) {
          return;
        }
        let content: string;
        try {
          const stats = await fs.stat(absPath);
          if (stats.size > MAX_INDEXED_FILE_BYTES) {
            return;
          }
          content = await fs.readFile(absPath, "utf-8");
        } catch {
          return;
        }
        for (const symbol of extractSymbols(content, relPath)) {
          const location: CodeSymbolLocation = { ...symbol, path: relPath };
          const existing = byName.get(symbol.name);
          if (existing) {
            existing.push(location);
          } else {
            byName.set(symbol.name, [location]);
          }
        }
      },
    });
    return byName;
  }
}
