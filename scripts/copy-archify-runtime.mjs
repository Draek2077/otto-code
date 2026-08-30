import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(repositoryRoot, "vendor/archify/archify");
const destination = resolve(
  repositoryRoot,
  "packages/server/dist/server/server/archify/vendor/archify",
);

if (!existsSync(source)) {
  throw new Error(`Vendored Archify runtime is missing at ${source}`);
}

rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });
