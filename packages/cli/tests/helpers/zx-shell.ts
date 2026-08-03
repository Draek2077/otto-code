/**
 * The suite's `$`: zx's, with a POSIX shell resolved before first use.
 *
 * Import `$` from here rather than from "zx" directly. zx picks its shell once
 * at import time and leaves `$` unusable when it cannot find bash, which is the
 * default on Windows (see ./posix-shell.ts). Routing every use through this
 * module guarantees the shell is configured before the first command runs, and
 * makes the dependency greppable instead of an invisible side effect.
 */

import { $ } from "zx";
import { configureZxShell } from "./posix-shell.ts";

configureZxShell();

export { $ };
