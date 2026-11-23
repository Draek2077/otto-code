import fs from "node:fs";
import path from "node:path";

export interface CommandPlan {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** npm.cmd/npx.cmd reparse model-controlled arguments; invoke their JS entry instead. */
export function commandPlan(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  executable = process.execPath,
): CommandPlan {
  if (platform !== "win32" || !["npm", "npx"].includes(command)) return { command, args, env };
  const cliName = `${command}-cli.js`;
  const candidates = [
    env.npm_execpath && path.join(path.dirname(env.npm_execpath), cliName),
    path.join(path.dirname(executable), "node_modules", "npm", "bin", cliName),
    ...(env.PATH ?? env.Path ?? "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((directory) => path.join(directory, "node_modules", "npm", "bin", cliName)),
  ];
  const cli = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!cli)
    throw new Error(
      `Brain benchmark could not locate ${cliName}; use an existing Node/npm installation`,
    );
  return { command: executable, args: [cli, ...args], env: { ...env, ELECTRON_RUN_AS_NODE: "1" } };
}
