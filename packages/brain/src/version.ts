/** Resolves the package version at runtime from package.json. */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function resolveVersion(): string {
  const pkg = require("../package.json") as { version?: unknown };
  return typeof pkg.version === "string" ? pkg.version : "0.0.0";
}
