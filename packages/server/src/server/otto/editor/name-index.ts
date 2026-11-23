import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { extractSymbols, type CodeSymbol } from "@getpaseo/highlight/otto/symbols";
import { extractMarkdownHeadings } from "@getpaseo/highlight/otto/headings";
import { getParserForFile } from "@getpaseo/highlight";
import type {
  EditorDocument,
  EditorQueryResult,
  EditorPosition,
} from "@getpaseo/plugin/otto/editor";
import type { z } from "zod";
import { walkWorkspaceSourceFiles } from "../../../utils/directory-suggestions.js";
import { pathKey } from "./lsp/uri.js";
import { emptyResult } from "./lsp/results.js";

interface Entry extends CodeSymbol {
  file: string;
}
interface Index {
  builtAt: number;
  generation: number;
  entries: Entry[];
  truncated: boolean;
}
interface Cache {
  generation: number;
  value: Index | null;
  building: Promise<Index> | null;
}
function range(symbol: CodeSymbol) {
  const start = { line: symbol.line - 1, character: symbol.column - 1 };
  return { start, end: { ...start, character: start.character + symbol.name.length } };
}
function nameAt(text: string, position: z.infer<typeof EditorPosition>) {
  const line = text.split(/\r\n|\r|\n/u)[position.line] ?? "";
  const before = line.slice(0, position.character).match(/[$_\p{ID_Continue}]+$/u)?.[0] ?? "";
  const after = line.slice(position.character).match(/^[$_\p{ID_Continue}]+/u)?.[0] ?? "";
  return before + after;
}
/** Bounded name navigation, not type resolution. A semantic server's empty
 * answer remains authoritative; only absent capabilities use this index. */
export class EditorNameIndex {
  private readonly caches = new Map<string, Cache>();
  invalidate(root: string) {
    const cache = this.caches.get(pathKey(root));
    if (cache) {
      cache.generation++;
      cache.value = null;
    }
  }
  release(root: string) {
    this.caches.delete(pathKey(root));
  }
  close() {
    this.caches.clear();
  }
  outline(document: EditorDocument) {
    const result = emptyResult("symbols");
    result.source = "name-index";
    result.message = "Name-based outline; no type resolution.";
    if (/\.(?:md|mdx|markdown)$/iu.test(document.file)) {
      result.message = "Document headings.";
      result.symbols = extractMarkdownHeadings(document.text)
        .slice(0, 10000)
        .map((heading) => ({
          name: heading.text,
          detail: `Heading ${heading.level}`,
          kind: 13,
          depth: heading.level - 1,
          range: {
            start: { line: heading.line - 1, character: 0 },
            end: { line: heading.line - 1, character: heading.text.length },
          },
        }));
      return result;
    }
    result.symbols = extractSymbols(document.text, document.file)
      .slice(0, 10000)
      .map((symbol) => ({
        name: symbol.name,
        kind: symbol.kind === "class" ? 5 : 13,
        detail: symbol.kind,
        depth: 0,
        range: range(symbol),
      }));
    return result;
  }
  async find(
    document: EditorDocument,
    position: z.infer<typeof EditorPosition>,
    query?: string,
  ): Promise<EditorQueryResult> {
    const result = emptyResult(query === undefined ? "definition" : "workspaceSymbols");
    result.source = "name-index";
    result.message =
      "Name-based results; no type resolution. Refresh by searching again after disk changes.";
    const name = query?.trim() ?? nameAt(document.text, position);
    if (!name) return result;
    const index = await this.index(document.root);
    const current = extractSymbols(document.text, document.file).map((symbol) => ({
      name: symbol.name,
      kind: symbol.kind,
      line: symbol.line,
      column: symbol.column,
      file: document.file,
    }));
    const entries = [
      ...index.entries.filter((entry) => pathKey(entry.file) !== pathKey(document.file)),
      ...current,
    ];
    const needle = name.toLocaleLowerCase();
    const matches = entries.filter((entry) =>
      query === undefined ? entry.name === name : entry.name.toLocaleLowerCase().includes(needle),
    );
    matches.sort(
      (a, b) =>
        Number(b.name === name) - Number(a.name === name) ||
        a.name.localeCompare(b.name) ||
        a.file.localeCompare(b.file),
    );
    result.locations = matches
      .slice(0, 1000)
      .map((entry) => ({ file: entry.file, range: range(entry) }));
    result.truncated = index.truncated || matches.length > 1000;
    return result;
  }
  private async index(root: string) {
    const key = pathKey(root);
    let cache = this.caches.get(key);
    if (!cache) {
      if (this.caches.size >= 4) {
        const oldest = this.caches.keys().next().value;
        if (oldest) this.caches.delete(oldest);
      }
      cache = { generation: 0, value: null, building: null };
      this.caches.set(key, cache);
    }
    if (cache.value && Date.now() - cache.value.builtAt < 30000) return cache.value;
    if (cache.building) return cache.building;
    const generation = cache.generation;
    cache.building = this.build(root, generation);
    try {
      const value = await cache.building;
      if (cache.generation === generation) cache.value = value;
      return value;
    } finally {
      cache.building = null;
    }
  }
  private async build(root: string, generation: number): Promise<Index> {
    const entries: Entry[] = [];
    let bytes = 0;
    let capped = false;
    const walk = await walkWorkspaceSourceFiles(
      root,
      async (absolute, relative) => {
        if (capped || !getParserForFile(relative)) return;
        const info = await stat(absolute).catch(() => null);
        if (!info || info.size > 1000000) return;
        bytes += info.size;
        if (bytes > 32 * 1024 * 1024 || entries.length >= 100000) {
          capped = true;
          return;
        }
        const text = await readFile(absolute, "utf8").catch(() => null);
        if (text === null) return;
        for (const symbol of extractSymbols(text, relative)) {
          if (entries.length >= 100000) {
            capped = true;
            break;
          }
          entries.push({ ...symbol, file: path.join(root, relative) });
        }
      },
      { files: 5000, entries: 20000 },
    );
    return { builtAt: Date.now(), generation, entries, truncated: capped || walk.truncated };
  }
}
