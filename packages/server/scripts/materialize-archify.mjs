// OTTO(architectural-views): carry the pinned offline renderer into every daemon package.
import { cp, mkdir, readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const source = path.join(root, "vendor", "archify", "archify");
const destination = path.join(
  root,
  "packages/server/dist/server/server/otto/architectural-views/vendor/archify",
);
const relative = path.relative(path.join(root, "packages/server/dist"), destination);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
  throw new Error("Renderer output escaped server dist");
const metadata = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"));
if (metadata.version !== "2.17.0-dev.1")
  throw new Error("Review the pinned Archify runtime before updating its distribution");
await mkdir(destination, { recursive: true });
// No browser/opener/network commands, examples, dev dependencies or default brand catalogue.
for (const entry of [
  "assets",
  "renderers",
  "schemas",
  "delta",
  "migrations",
  "references",
  "recipes",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "package.json",
  "skill-release.json",
  "bin/archify.mjs",
  "scripts/check-render-output.mjs",
]) {
  const input = path.join(source, entry);
  if ((await lstat(input)).isSymbolicLink())
    throw new Error("Pinned runtime cannot contain linked inputs");
  await cp(input, path.join(destination, entry), { recursive: true });
}
await cp(
  path.join(root, "vendor/archify/OTTO-PATCHES.md"),
  path.join(destination, "OTTO-PATCHES.md"),
);
console.log("Pinned offline Archify renderer materialized in server dist");
