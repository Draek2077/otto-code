import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MANAGED_RUNTIME_NAME = /^[a-z0-9][a-z0-9._-]*$/iu;

export function resolveManagedRuntimePath(ottoHome: string, runtimeName: string): string {
  if (!MANAGED_RUNTIME_NAME.test(runtimeName)) {
    throw new Error("Invalid managed runtime name.");
  }

  const runtimeRoot = path.resolve(ottoHome, "otto-brain", "runtimes");
  const runtimePath = path.resolve(runtimeRoot, runtimeName);
  if (path.dirname(runtimePath) !== runtimeRoot) {
    throw new Error("Managed runtime path must remain inside Otto's runtime directory.");
  }
  return runtimePath;
}

function powerShellLiteral(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

export function buildElevatedRuntimeRemovalScript(runtimePath: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$runtimePath = ${powerShellLiteral(runtimePath)}`,
    "if (-not (Test-Path -LiteralPath $runtimePath -PathType Container)) { exit 2 }",
    "Remove-Item -LiteralPath $runtimePath -Recurse -Force -ErrorAction Stop",
  ].join("; ");
}

function encodePowerShellScript(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

/**
 * Requests Windows elevation for one already-selected Otto managed runtime.
 * The elevated process receives an encoded, fixed-scope deletion script - it
 * never accepts a shell command or an arbitrary path from the renderer.
 */
export async function removeManagedRuntimeWithElevation({
  ottoHome,
  runtimeName,
  platform = process.platform,
}: {
  ottoHome: string;
  runtimeName: string;
  platform?: NodeJS.Platform;
}): Promise<void> {
  if (platform !== "win32") {
    throw new Error("Administrator runtime removal is available only on Windows.");
  }

  const runtimePath = resolveManagedRuntimePath(ottoHome, runtimeName);
  const encodedScript = encodePowerShellScript(buildElevatedRuntimeRemovalScript(runtimePath));
  const launcher = [
    "$ErrorActionPreference = 'Stop'",
    "$child = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru",
    `-ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', '${encodedScript}')`,
    "if ($child.ExitCode -ne 0) { exit $child.ExitCode }",
  ].join("; ");

  try {
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      launcher,
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/cancelled|canceled|1223/iu.test(message)) {
      throw new Error("Administrator permission was cancelled.", { cause: error });
    }
    throw new Error(`Administrator removal did not complete: ${message}`, { cause: error });
  }
}
