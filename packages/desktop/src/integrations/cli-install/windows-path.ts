/**
 * Windows PATH registration for the bundled `otto` shim.
 *
 * On POSIX the installer appends an export line to a shell rc file. Windows has
 * no equivalent, and `~/.local/bin` is a POSIX convention Windows does not put
 * on PATH by default, so before this existed "Install CLI" wrote
 * `~/.local/bin/otto.cmd` and nothing could find it unless some other tool
 * (uv, pipx) had already registered that directory.
 *
 * Two hazards this module exists to avoid:
 *
 *  1. `[Environment]::GetEnvironmentVariable('Path','User')` EXPANDS a
 *     REG_EXPAND_SZ value. Reading it that way and writing it back would bake
 *     the current expansion of every `%VAR%` into the user's PATH permanently.
 *     We read raw (DoNotExpandEnvironmentNames) and write back the same value
 *     kind, appending only.
 *  2. `setx` truncates at 1024 characters and silently corrupts long PATHs.
 *     Never use it here.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Registry value kinds we may encounter for the user's Path. */
type PathValueKind = "String" | "ExpandString";

export interface WindowsUserPath {
  /** The unexpanded value, exactly as stored. */
  raw: string;
  kind: PathValueKind;
}

export interface WindowsPathPlan {
  needsUpdate: boolean;
  nextPath: string;
}

function normalizeSegment(segment: string): string {
  return segment
    .trim()
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

/** Expand `%VAR%` references so `%USERPROFILE%\.local\bin` matches a resolved path. */
function expandWindowsVars(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/g, (match, name: string) => env[name] ?? match);
}

/**
 * Decide whether `binDir` needs appending to the user's raw PATH value.
 *
 * Pure, so the comparison rules (case-insensitivity, trailing separators,
 * `%VAR%` indirection) are testable without touching the registry.
 */
export function planWindowsPathUpdate(input: {
  currentRawPath: string;
  binDir: string;
  env?: NodeJS.ProcessEnv;
}): WindowsPathPlan {
  const { currentRawPath, binDir } = input;
  const env = input.env ?? process.env;
  const target = normalizeSegment(binDir);

  if (target.length === 0) {
    return { needsUpdate: false, nextPath: currentRawPath };
  }

  const present = currentRawPath.split(";").some((segment) => {
    if (segment.trim().length === 0) return false;
    if (normalizeSegment(segment) === target) return true;
    return normalizeSegment(expandWindowsVars(segment, env)) === target;
  });

  if (present) {
    return { needsUpdate: false, nextPath: currentRawPath };
  }

  // Append rather than prepend: the shim should not shadow a tool the user has
  // deliberately put earlier on PATH. Existing segments are never rewritten.
  const trimmed = currentRawPath.replace(/;+$/, "");
  return {
    needsUpdate: true,
    nextPath: trimmed.length > 0 ? `${trimmed};${binDir}` : binDir,
  };
}

const POWERSHELL_ARGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];

const READ_SCRIPT = `
$ErrorActionPreference = 'Stop'
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
if ($null -eq $key) { $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment') }
$raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
$kind = 'ExpandString'
try { $kind = $key.GetValueKind('Path').ToString() } catch { }
if ($kind -ne 'String' -and $kind -ne 'ExpandString') { $kind = 'ExpandString' }
[Console]::Out.Write((ConvertTo-Json @{ raw = $raw; kind = $kind } -Compress))
`.trim();

// The new value rides in on the environment so it never has to survive
// PowerShell quoting. A PATH full of spaces, quotes and semicolons is normal.
const WRITE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
if ($null -eq $key) { $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment') }
$kind = [Enum]::Parse([Microsoft.Win32.RegistryValueKind], $env:OTTO_CLI_PATH_KIND)
$key.SetValue('Path', $env:OTTO_CLI_PATH_VALUE, $kind)
$key.Dispose()
# .NET broadcasts WM_SETTINGCHANGE on any user-env write, so this no-op delete
# is what tells Explorer to pick the new PATH up for newly launched processes.
[Environment]::SetEnvironmentVariable('OTTO_PATH_REFRESH', $null, 'User')
`.trim();

export async function readWindowsUserPath(): Promise<WindowsUserPath> {
  const { stdout } = await execFileAsync("powershell.exe", [...POWERSHELL_ARGS, READ_SCRIPT], {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  const parsed: unknown = JSON.parse(stdout);
  const record = parsed as { raw?: unknown; kind?: unknown };
  const kind = record.kind === "String" ? "String" : "ExpandString";
  return { raw: typeof record.raw === "string" ? record.raw : "", kind };
}

async function writeWindowsUserPath(value: string, kind: PathValueKind): Promise<void> {
  await execFileAsync("powershell.exe", [...POWERSHELL_ARGS, WRITE_SCRIPT], {
    windowsHide: true,
    env: { ...process.env, OTTO_CLI_PATH_VALUE: value, OTTO_CLI_PATH_KIND: kind },
  });
}

/**
 * Ensure `binDir` is on the persisted user PATH. Returns whether anything
 * changed. Already-open terminals will not see it; new ones will.
 */
export async function ensureWindowsUserPath(binDir: string): Promise<{ updated: boolean }> {
  const current = await readWindowsUserPath();
  const plan = planWindowsPathUpdate({ currentRawPath: current.raw, binDir });
  if (!plan.needsUpdate) {
    return { updated: false };
  }
  // Paranoia: only ever grow the value. A shorter result means we computed
  // something wrong, and a truncated PATH is a genuinely destructive bug.
  if (plan.nextPath.length < current.raw.length) {
    throw new Error("refusing to shrink the user PATH");
  }
  await writeWindowsUserPath(plan.nextPath, current.kind);
  return { updated: true };
}
