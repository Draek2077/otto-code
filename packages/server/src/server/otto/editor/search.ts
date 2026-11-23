import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { minimatch } from "minimatch";
import type { EditorSearchOptions, EditorSearchResult } from "@getpaseo/plugin/otto/editor";
import { walkWorkspaceSourceFiles } from "../../../utils/directory-suggestions.js";
import { readExplorerFile } from "../../file-explorer/service.js";
import { EditorError } from "./errors.js";
import type { EditorRenames } from "./rename.js";
import { SearchMatcher } from "./search-matcher.js";

interface Search {
  clientId: string;
  root: string;
  options: EditorSearchOptions;
  sources: Map<string, string>;
  time: number;
}
class SearchLimit extends Error {}
/** Search snapshots are reviewed against disk before planning and again before
 * applying. They never replace the editor draft or bypass its dirty-peer guard. */
export class EditorSearches {
  private readonly searches = new Map<string, Search>();
  private active = 0;
  root(clientId: string, searchId: string) {
    const search = this.searches.get(searchId);
    if (!search || search.clientId !== clientId || Date.now() - search.time > 15 * 60000)
      throw new EditorError("conflict", "Search expired. Search again before replacing.");
    return search.root;
  }
  async search(
    clientId: string,
    rootPath: string,
    options: EditorSearchOptions,
    isCurrent: () => boolean,
  ): Promise<EditorSearchResult> {
    if (this.active >= 2)
      throw new EditorError(
        "unavailable",
        "Two searches are already running. Wait before searching again.",
      );
    this.active++;
    const matcher = new SearchMatcher();
    try {
      const root = await realpath(rootPath);
      const search: Search = { clientId, root, options, sources: new Map(), time: Date.now() };
      const result: EditorSearchResult = {
        searchId: randomUUID(),
        scannedFiles: 0,
        matches: [],
        truncated: false,
      };
      let bytes = 0;
      let matchedBytes = 0;
      // Validate the expression even when the directory is empty.
      await matcher.match("", options);
      try {
        const walked = await walkWorkspaceSourceFiles(
          root,
          async (file, relative) => {
            if (!isCurrent()) throw new EditorError("closed", "Search demand was released.");
            if (!included(relative, options)) return;
            const read = await readExplorerFile({ root, relativePath: relative });
            if (read.kind !== "text" || read.content === undefined || read.size > 1000000) return;
            result.scannedFiles++;
            bytes += read.size;
            if (bytes > 32 * 1024 * 1024) throw new SearchLimit();
            const found = await matcher.match(read.content.replace(/^\uFEFF/u, ""), options);
            if (!found.count) return;
            if (matchedBytes + read.size > 4 * 1024 * 1024) throw new SearchLimit();
            matchedBytes += read.size;
            search.sources.set(file, read.content);
            result.matches.push(
              ...found.matches
                .slice(0, 2000 - result.matches.length)
                .map((match) => Object.assign({ file }, match)),
            );
            if (result.matches.length >= 2000 || found.count > found.matches.length)
              throw new SearchLimit();
          },
          { files: 5000, entries: 20000 },
        );
        result.truncated = walked.truncated;
      } catch (error) {
        if (!(error instanceof SearchLimit)) throw error;
        result.truncated = true;
      }
      if (!isCurrent()) throw new EditorError("closed", "Search demand was released.");
      this.prune();
      this.searches.set(result.searchId, search);
      return result;
    } finally {
      this.active--;
      await matcher.close();
    }
  }
  async plan(
    clientId: string,
    searchId: string,
    files: readonly string[],
    replacement: string,
    renames: EditorRenames,
    isCurrent: () => boolean,
  ) {
    if (this.active >= 2)
      throw new EditorError(
        "unavailable",
        "Two search operations are already running. Wait before reviewing another replacement.",
      );
    this.prune();
    const search = this.searches.get(searchId);
    if (!search || search.clientId !== clientId)
      throw new EditorError("conflict", "Search expired. Search again before replacing.");
    const matcher = new SearchMatcher();
    this.active++;
    try {
      const proposed = [];
      for (const file of new Set(files)) {
        if (!isCurrent()) throw new EditorError("closed", "Replacement demand was released.");
        const before = search.sources.get(file);
        if (before === undefined)
          throw new EditorError("invalid", "The file is not in this search snapshot.");
        const bom = before.startsWith("\uFEFF") ? "\uFEFF" : "";
        const found = await matcher.match(before.slice(bom.length), search.options, replacement);
        if (found.after !== null && bom + found.after !== before)
          proposed.push({
            file: path.resolve(file),
            before,
            after: bom + found.after,
            editCount: found.count,
          });
      }
      return await renames.review(clientId, search.root, proposed);
    } finally {
      this.active--;
      await matcher.close();
    }
  }
  releaseClient(clientId: string) {
    for (const [key, value] of this.searches)
      if (value.clientId === clientId) this.searches.delete(key);
  }
  private prune() {
    for (const [key, value] of this.searches)
      if (Date.now() - value.time > 15 * 60000) this.searches.delete(key);
    while (this.searches.size >= 8) {
      const oldest = this.searches.keys().next().value;
      if (oldest) this.searches.delete(oldest);
    }
  }
}
function included(file: string, options: EditorSearchOptions) {
  return (
    (!options.include.trim() || minimatch(file, options.include.trim(), { matchBase: true })) &&
    (!options.exclude.trim() || !minimatch(file, options.exclude.trim(), { matchBase: true }))
  );
}
