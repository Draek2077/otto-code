import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Test-only scratch parent; never resolves an installed or development home. */
export function fixtureRoot(): string {
  const root = fileURLToPath(new URL("../../.tmp/", import.meta.url));
  mkdirSync(root, { recursive: true });
  return root;
}
