import { OTTO_DEFAULT_HOME } from "@getpaseo/protocol/otto/identity";
import os from "node:os";
import path from "node:path";

function expandHomeDir(input: string): string {
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  if (input === "~") {
    return os.homedir();
  }
  return input;
}

export function resolvePaseoHome(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PASEO_HOME ?? OTTO_DEFAULT_HOME; // OTTO(identity)
  const resolved = path.resolve(expandHomeDir(raw));
  return resolved;
}
