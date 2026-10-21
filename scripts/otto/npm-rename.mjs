// Publish-time rename of Otto's npm packages. Source keeps Paseo's workspace
// names (`@getpaseo/*`); npm sees Otto's (`@otto-code/*`). This module rewrites
// an unpacked `npm pack` tree in place: the package manifest, and every
// `@getpaseo/` occurrence in the packed JavaScript, declarations, JSON, and
// Markdown. See docs/otto-release.md.
//
// Two things deliberately stay Paseo, because they are not references to an
// installed package but identifiers plugin authors write:
//
// - String literals naming the Paseo plugin SDK (`@getpaseo/plugin` and its
//   subpaths, plus the `@getpaseo/protocol/` prefix the plugin compiler checks)
//   when they are not a module specifier. The server's plugin compiler and
//   bundle evaluator compare plugin imports against these strings, and Paseo
//   plugins import `@getpaseo/plugin/...`. Renaming them would break every
//   Paseo plugin. A module specifier (`from "..."`, `import(...)`,
//   `require(...)`) is the host's own import of its dependency and is renamed,
//   because the installed dependency is `@otto-code/plugin`.
// - Plugin source the server ships to compile at runtime
//   (`dist/server/builtin-plugins/`). Those files are plugin-author code and
//   import the SDK by its Paseo name.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const PASEO_SCOPE = "@getpaseo/";
export const OTTO_SCOPE = "@otto-code/";
export const OTTO_REPOSITORY_URL = "git+https://github.com/Draek2077/otto-code.git";
export const OTTO_HOMEPAGE = "https://otto-code.me";
export const OTTO_BUGS_URL = "https://github.com/Draek2077/otto-code/issues";

// Package-relative directories holding plugin-author source. Never rewritten.
export const AUTHOR_SOURCE_DIRECTORIES = ["dist/server/builtin-plugins/"];

const TEXT_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
  ".json",
  ".md",
  ".txt",
  ".html",
  ".css",
]);

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "peerDependenciesMeta",
];

const QUOTED_PASEO_LITERAL = /(["'`])(@getpaseo\/[^"'`\s]*)\1/g;
// Text directly before a quote that makes the literal a module specifier.
const SPECIFIER_CONTEXT = /(?:\bfrom|\bimport|require|\.resolve|\bmodule)\s*\(?\s*$/;

export function toOttoPackageName(name) {
  return typeof name === "string" && name.startsWith(PASEO_SCOPE)
    ? OTTO_SCOPE + name.slice(PASEO_SCOPE.length)
    : name;
}

function isPluginAuthorLiteral(value) {
  return /^@getpaseo\/plugin(?:\/[\w./-]*)?$/.test(value) || value === "@getpaseo/protocol/";
}

/** Index ranges of `@getpaseo/` occurrences that must stay Paseo. */
function preservedRanges(text) {
  const ranges = [];
  for (const match of text.matchAll(QUOTED_PASEO_LITERAL)) {
    const value = match[2];
    if (!isPluginAuthorLiteral(value)) continue;
    const before = text.slice(Math.max(0, match.index - 24), match.index);
    if (SPECIFIER_CONTEXT.test(before)) continue;
    const start = match.index + 1;
    ranges.push([start, start + value.length]);
  }
  return ranges;
}

function scopeOccurrences(text) {
  const indexes = [];
  for (let index = text.indexOf(PASEO_SCOPE); index !== -1; ) {
    indexes.push(index);
    index = text.indexOf(PASEO_SCOPE, index + PASEO_SCOPE.length);
  }
  return indexes;
}

/**
 * Renames `@getpaseo/` to `@otto-code/` in source text, except the plugin
 * author literals described at the top of this file.
 */
export function rewriteText(text) {
  const ranges = preservedRanges(text);
  const isPreserved = (index) => ranges.some(([start, end]) => index >= start && index < end);
  let out = "";
  let cursor = 0;
  let renamed = 0;
  let preserved = 0;
  for (const index of scopeOccurrences(text)) {
    if (isPreserved(index)) {
      preserved += 1;
      continue;
    }
    out += text.slice(cursor, index) + OTTO_SCOPE;
    cursor = index + PASEO_SCOPE.length;
    renamed += 1;
  }
  out += text.slice(cursor);
  return { text: out, renamed, preserved };
}

/** Occurrences rewriteText would still rename; zero after a correct rewrite. */
export function countUnrenamed(text) {
  return rewriteText(text).renamed;
}

function renameKeys(map) {
  if (!map || typeof map !== "object" || Array.isArray(map)) return map;
  return Object.fromEntries(
    Object.entries(map).map(([key, value]) => [toOttoPackageName(key), value]),
  );
}

/**
 * The manifest npm publishes: Otto's package name, Otto's dependency names,
 * and the repository fields npm trusted publishing checks. The `bin` map is
 * kept as packed (the CLI installs its launcher as `otto`).
 */
export function rewritePackageJson(manifest, { directory, license } = {}) {
  const out = { ...manifest, name: toOttoPackageName(manifest.name) };
  for (const field of DEPENDENCY_FIELDS) {
    if (out[field]) out[field] = renameKeys(out[field]);
  }
  for (const field of ["bundleDependencies", "bundledDependencies"]) {
    if (Array.isArray(out[field])) out[field] = out[field].map(toOttoPackageName);
  }
  if (typeof out.description === "string") {
    out.description = out.description.replace(/\bPaseo\b/g, "Otto");
  }
  out.homepage = OTTO_HOMEPAGE;
  out.bugs = { url: OTTO_BUGS_URL };
  out.repository = {
    type: "git",
    url: OTTO_REPOSITORY_URL,
    ...(directory ? { directory } : {}),
  };
  if (license) out.license = license;
  return out;
}

function isAuthorSource(relativePath) {
  return AUTHOR_SOURCE_DIRECTORIES.some((directory) => relativePath.startsWith(directory));
}

function isTextCandidate(relativePath) {
  if (relativePath.startsWith("bin/")) return true;
  const base = path.posix.basename(relativePath);
  if (base.endsWith(".d.ts") || base.endsWith(".d.mts") || base.endsWith(".d.cts")) return true;
  return TEXT_EXTENSIONS.has(path.posix.extname(base));
}

function walk(root, relative = "") {
  const files = [];
  for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walk(root, childRelative));
    else if (entry.isFile()) files.push(childRelative);
  }
  return files;
}

/**
 * Rewrites an unpacked package directory (the `package/` folder of an npm
 * tarball) in place and returns what changed. Throws when an occurrence that
 * should have been renamed survives, so a bad rewrite never reaches npm.
 */
export function rewritePackedTree(packageDir, { directory, license } = {}) {
  const changedFiles = [];
  let renamed = 0;
  let preserved = 0;
  for (const relativePath of walk(packageDir)) {
    const filePath = path.join(packageDir, relativePath);
    if (relativePath === "package.json") {
      const manifest = JSON.parse(readFileSync(filePath, "utf8"));
      writeFileSync(
        filePath,
        `${JSON.stringify(rewritePackageJson(manifest, { directory, license }), null, 2)}\n`,
      );
      changedFiles.push(relativePath);
      continue;
    }
    if (isAuthorSource(relativePath) || !isTextCandidate(relativePath)) continue;
    if (statSync(filePath).size === 0) continue;
    const buffer = readFileSync(filePath);
    if (buffer.includes(0)) continue;
    const source = buffer.toString("utf8");
    if (!source.includes(PASEO_SCOPE)) continue;
    const result = rewriteText(source);
    preserved += result.preserved;
    if (result.renamed === 0) continue;
    if (countUnrenamed(result.text) !== 0) {
      throw new Error(`Rename left @getpaseo/ references in ${relativePath}`);
    }
    writeFileSync(filePath, result.text);
    renamed += result.renamed;
    changedFiles.push(relativePath);
  }
  return { changedFiles, renamed, preserved };
}
