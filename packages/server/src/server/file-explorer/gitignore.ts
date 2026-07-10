import { promises as fs } from "node:fs";
import path from "node:path";

// Pure-JS gitignore matching for the project-search walker. Covers the
// patterns that matter in practice — blank/comment lines, `!` negation,
// trailing `/` (directory-only), leading `/` (anchored), `*`, `?`, `**`, and
// basename matching for slash-less patterns — with git's last-match-wins
// precedence. Exotic corners (character-class ranges with escapes, re-include
// inside excluded directories) are intentionally out of scope; nothing is
// spawned and no dependency is added.

export interface GitignoreRule {
  regex: RegExp;
  negated: boolean;
  dirOnly: boolean;
  /** POSIX dir (relative to the walk root, "" for root) the rule applies under. */
  baseDir: string;
}

function escapeRegExpChar(char: string): string {
  return /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

/**
 * Converts one gitignore glob into a regex over a base-relative POSIX path.
 * `anchored` distinguishes `foo/bar` (relative to the gitignore's directory)
 * from `bar` (basename match at any depth).
 */
function globToRegExp(pattern: string, anchored: boolean): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        // `**` spans directories; a following slash is folded into the group.
        if (pattern[index + 2] === "/") {
          source += "(?:[^/]+/)*";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegExpChar(char);
  }
  const prefix = anchored ? "^" : "(?:^|/)";
  return new RegExp(`${prefix}${source}(?:$|/)`);
}

export function parseGitignore(content: string, baseDir: string): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine;
    if (!line || line.startsWith("#")) {
      continue;
    }
    // Trailing spaces are ignored unless escaped; the escape case is rare
    // enough to skip.
    line = line.replace(/\s+$/, "");
    if (!line) {
      continue;
    }
    let negated = false;
    if (line.startsWith("!")) {
      negated = true;
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    if (!line) {
      continue;
    }
    // A slash anywhere (other than trailing, already stripped) anchors the
    // pattern to the gitignore's own directory.
    const anchored = line.includes("/");
    if (line.startsWith("/")) {
      line = line.slice(1);
    }
    try {
      rules.push({ regex: globToRegExp(line, anchored), negated, dirOnly, baseDir });
    } catch {
      // An unparseable pattern is safer to drop than to guess at.
    }
  }
  return rules;
}

/**
 * Rule stack for a depth-first walk: rules from parent directories apply to
 * everything beneath them, and the closest-then-latest matching rule wins.
 */
export class GitignoreStack {
  private readonly rules: GitignoreRule[] = [];
  private readonly frameSizes: number[] = [];

  pushFrame(rules: GitignoreRule[]): void {
    this.frameSizes.push(rules.length);
    this.rules.push(...rules);
  }

  popFrame(): void {
    const size = this.frameSizes.pop() ?? 0;
    if (size > 0) {
      this.rules.length -= size;
    }
  }

  /** `relPath` is POSIX, relative to the walk root, no leading slash. */
  isIgnored(relPath: string, isDirectory: boolean): boolean {
    let ignored = false;
    for (const rule of this.rules) {
      if (rule.dirOnly && !isDirectory) {
        continue;
      }
      let candidate = relPath;
      if (rule.baseDir) {
        if (!relPath.startsWith(`${rule.baseDir}/`)) {
          continue;
        }
        candidate = relPath.slice(rule.baseDir.length + 1);
      }
      if (rule.regex.test(candidate)) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  }
}

export async function readGitignoreRules(
  directory: string,
  baseDir: string,
): Promise<GitignoreRule[]> {
  try {
    const content = await fs.readFile(path.join(directory, ".gitignore"), "utf-8");
    return parseGitignore(content, baseDir);
  } catch {
    return [];
  }
}

export interface WalkWorkspaceOptions {
  /** Called with each non-ignored file's absolute + workspace-relative path. */
  onFile: (file: { absPath: string; relPath: string }) => Promise<void> | void;
  /** Stop the walk early once this many files have been visited. */
  fileLimit?: number;
  /** Yield to the event loop every N files so a big tree can't block. */
  yieldEvery?: number;
}

/**
 * Depth-first, .gitignore-aware file walk shared by project search and the
 * code index. Skips `.git`, applies parent-to-child gitignore precedence, and
 * yields periodically. Returns true if the walk was truncated by `fileLimit`.
 */
export async function walkWorkspaceFiles(
  root: string,
  options: WalkWorkspaceOptions,
): Promise<boolean> {
  const ignore = new GitignoreStack();
  const yieldEvery = options.yieldEvery ?? 200;
  let visited = 0;
  let sinceYield = 0;
  let truncated = false;

  async function walk(absDir: string, relDir: string): Promise<void> {
    if (truncated) {
      return;
    }
    ignore.pushFrame(await readGitignoreRules(absDir, relDir));
    try {
      let dirents;
      try {
        dirents = await fs.readdir(absDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const dirent of dirents) {
        if (truncated) {
          return;
        }
        const relPath = relDir ? `${relDir}/${dirent.name}` : dirent.name;
        if (dirent.isDirectory()) {
          if (dirent.name === ".git" || ignore.isIgnored(relPath, true)) {
            continue;
          }
          await walk(path.join(absDir, dirent.name), relPath);
          continue;
        }
        if (!dirent.isFile() || ignore.isIgnored(relPath, false)) {
          continue;
        }
        visited += 1;
        if (options.fileLimit && visited > options.fileLimit) {
          truncated = true;
          return;
        }
        sinceYield += 1;
        if (sinceYield >= yieldEvery) {
          sinceYield = 0;
          await new Promise((resolve) => setImmediate(resolve));
        }
        await options.onFile({ absPath: path.join(absDir, dirent.name), relPath });
      }
    } finally {
      ignore.popFrame();
    }
  }

  const realRoot = await fs.realpath(root);
  await walk(realRoot, "");
  return truncated;
}
