import { ProcessPromise } from "zx";
import { $ } from "./zx-shell.ts";
import { join } from "node:path";

const CLI_ENTRY = join(import.meta.dirname, "..", "..", "dist", "index.js");

export function runLocalOtto(
  args: string[],
  env: NodeJS.ProcessEnv = {},
  cwd = process.cwd(),
): ProcessPromise {
  $.verbose = false;
  return $({
    cwd,
    env: { ...process.env, ...env },
  })`${process.execPath} ${CLI_ENTRY} ${args}`.nothrow();
}
