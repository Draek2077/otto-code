import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";

interface CommandResult {
  code: number | null;
  signal?: string | null;
  stdout: string;
  stderr: string;
}

interface DebInstallerDependencies {
  run(command: string, args: string[]): Promise<CommandResult>;
  checkFile(file: string, executable: boolean): Promise<void>;
  isRoot(): boolean;
  log(message: string): void;
}

// Keep Electron's event loop running while polkit displays its native password
// dialog and dpkg installs. Never interpret an installer filename as shell code.
export function runDebInstallerCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LC_ALL: "C" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(-16384);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-16384);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function checkFile(file: string, executable: boolean): Promise<void> {
  await access(file, executable ? constants.X_OK : constants.R_OK);
  if (!(await stat(file)).isFile()) throw new Error(`Not a regular file: ${file}`);
}

export async function installLinuxDeb(
  installerPath: string,
  log: (message: string) => void,
  overrides: Partial<DebInstallerDependencies> = {},
): Promise<void> {
  const deps: DebInstallerDependencies = {
    run: runDebInstallerCommand,
    checkFile,
    isRoot: () => process.getuid?.() === 0,
    log,
    ...overrides,
  };
  const dpkg = "/usr/bin/dpkg";
  const reader = "/usr/bin/dpkg-deb";
  const query = "/usr/bin/dpkg-query";
  const pkexec = "/usr/bin/pkexec";
  let stage = "Checking the downloaded package";
  try {
    if (!path.posix.isAbsolute(installerPath) || !installerPath.endsWith(".deb")) {
      throw new Error(`Invalid downloaded Debian package path: ${installerPath}`);
    }
    await deps.checkFile(installerPath, false);
    for (const command of [dpkg, reader, query]) await deps.checkFile(command, true);
    const root = deps.isRoot();
    if (!root) await deps.checkFile(pkexec, true);

    async function run(command: string, args: string[]): Promise<string> {
      deps.log(`${stage}: ${JSON.stringify([command, ...args])}`);
      const result = await deps.run(command, args);
      const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
      if (output) deps.log(output);
      if (result.code !== 0) {
        let explanation = `${command} exited with ${result.signal ? `signal ${result.signal}` : `code ${result.code}`}.`;
        if (command === pkexec && result.code === 126) {
          explanation = "The authorization dialog was cancelled.";
        } else if (command === pkexec && result.code === 127) {
          explanation =
            "Linux could not authorize the update. The desktop's polkit authentication agent may be unavailable.";
        }
        throw new Error(`${explanation}${output ? `\n${output}` : ""}`);
      }
      return result.stdout.trim();
    }

    const metadata = await run(reader, [
      "--show",
      "--showformat=${Package}\n${Version}",
      installerPath,
    ]);
    const [packageName, version] = metadata.split("\n");
    if (!packageName || !/^[a-z0-9][a-z0-9+.-]+$/.test(packageName) || !version) {
      throw new Error(`Cannot read the downloaded package's name and version: ${metadata}`);
    }

    stage = "Authorizing and installing the update";
    // One install attempt, equivalent to the user's working dpkg -i command.
    // Do not follow any failure with apt-get install -f: it can return success
    // after cancelled authorization without ever installing this package.
    await run(
      root ? dpkg : pkexec,
      root ? ["-i", installerPath] : ["--disable-internal-agent", dpkg, "-i", installerPath],
    );

    stage = "Verifying the installed update";
    const installed = await run(query, [
      "--show",
      "--showformat=${Status}\n${Version}",
      packageName,
    ]);
    if (installed !== `install ok installed\n${version}`) {
      throw new Error(
        `Expected ${packageName} ${version} to be installed; dpkg reports:\n${installed}`,
      );
    }
    deps.log(`Verified ${packageName} ${version}; ready to restart.`);
  } catch (error) {
    throw new Error(`${stage}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}
