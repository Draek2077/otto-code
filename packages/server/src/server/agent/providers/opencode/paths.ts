import path from "node:path";

import { resolveOttoHome } from "../../../otto-home.js";

const OPENCODE_HOME_DIRNAME = "opencode-home";

export function resolveOpenCodeHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveOttoHome(env), OPENCODE_HOME_DIRNAME);
}
