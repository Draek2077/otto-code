import { existsSync } from "node:fs";
import path from "node:path";

// Run npm's JavaScript entry point on Windows. npm.cmd requires a shell, which
// reparses arguments and breaks package paths containing spaces or metacharacters.
export function npmCommand(args) {
  if (process.platform !== "win32") return { command: "npm", args };
  const cli =
    process.env.npm_execpath ??
    path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  if (!existsSync(cli))
    throw new Error("Run through npm so npm_execpath names its CLI entry point");
  return { command: process.execPath, args: [cli, ...args] };
}
