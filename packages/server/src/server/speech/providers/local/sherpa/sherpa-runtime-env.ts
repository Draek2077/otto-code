import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export type SherpaLoaderEnvKey = "LD_LIBRARY_PATH" | "DYLD_LIBRARY_PATH" | "PATH";

export interface SherpaLoaderEnvResolution {
  key: SherpaLoaderEnvKey;
  libDir: string;
  packageName: string;
}

export function sherpaPlatformArch(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  const normalizedPlatform = platform === "win32" ? "win" : platform;
  return `${normalizedPlatform}-${arch}`;
}

export function sherpaPlatformPackageName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return `sherpa-onnx-${sherpaPlatformArch(platform, arch)}`;
}

export function sherpaLoaderEnvKey(
  platform: NodeJS.Platform = process.platform,
): SherpaLoaderEnvKey | null {
  if (platform === "linux") {
    return "LD_LIBRARY_PATH";
  }
  if (platform === "darwin") {
    return "DYLD_LIBRARY_PATH";
  }
  if (platform === "win32") {
    return "PATH";
  }
  return null;
}

export function prependEnvPath(existing: string | undefined, value: string): string {
  const parts = (existing ?? "").split(path.delimiter).filter(Boolean);
  if (parts.includes(value)) {
    return parts.join(path.delimiter);
  }
  return [value, ...parts].join(path.delimiter);
}

/**
 * Redirect a path that landed inside `app.asar` to its `app.asar.unpacked`
 * twin. In a packaged Electron build `require.resolve` returns a path inside
 * the asar archive, which is a FILE, not a directory: nothing loads from it,
 * and electron-builder unpacks native modules to `app.asar.unpacked` for
 * exactly that reason.
 *
 * On Windows the un-redirected path is not merely useless, it is destructive.
 * We prepend this directory to the daemon's own PATH so the native addon can
 * find its DLLs, and every process the daemon spawns inherits it. Git's MSYS
 * layer rewrites PATH from POSIX to Windows form for native children, and it
 * gives up at the `app.asar` entry, silently dropping every entry after it,
 * including the one holding node itself. The symptom is every git hook in an
 * agent session dying in under a second with "'node' is not recognized", which
 * reads as a failed check rather than as a truncated PATH. See
 * docs/development.md.
 *
 * `exists` is injectable so the redirect is testable without a packaged build.
 */
export function resolveUnpackedLibDir(
  dir: string,
  exists: (candidate: string) => boolean = existsSync,
): string {
  const match = dir.match(/^(.*app\.asar)([\\/].*)$/);
  if (!match) {
    return dir;
  }
  const unpacked = `${match[1]}.unpacked${match[2]}`;
  return exists(unpacked) ? unpacked : dir;
}

export function resolveSherpaLoaderEnv(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): SherpaLoaderEnvResolution | null {
  const key = sherpaLoaderEnvKey(platform);
  if (!key) {
    return null;
  }

  const packageName = sherpaPlatformPackageName(platform, arch);
  const require = createRequire(import.meta.url);
  try {
    const pkgJson = require.resolve(`${packageName}/package.json`);
    return {
      key,
      libDir: resolveUnpackedLibDir(path.dirname(pkgJson)),
      packageName,
    };
  } catch {
    return null;
  }
}

/**
 * Find the actual case-sensitive key in a plain object that matches the given
 * key case-insensitively. On Windows, `{...process.env}` produces a plain
 * (case-sensitive) object where PATH is typically stored as `Path`. Using a
 * hardcoded `"PATH"` would miss the existing key and create a duplicate,
 * breaking the child process's PATH.
 */
function findEnvKey(env: NodeJS.ProcessEnv, key: string): string {
  const lower = key.toLowerCase();
  for (const k of Object.keys(env)) {
    if (k.toLowerCase() === lower) return k;
  }
  return key;
}

export function applySherpaLoaderEnv(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): {
  changed: boolean;
  key: SherpaLoaderEnvKey | null;
  libDir: string | null;
  packageName: string | null;
} {
  const resolved = resolveSherpaLoaderEnv(platform, arch);
  if (!resolved) {
    return {
      changed: false,
      key: null,
      libDir: null,
      packageName: null,
    };
  }

  const actualKey = findEnvKey(env, resolved.key);
  const next = prependEnvPath(env[actualKey], resolved.libDir);
  const changed = next !== (env[actualKey] ?? "");
  env[actualKey] = next;
  return {
    changed,
    key: resolved.key,
    libDir: resolved.libDir,
    packageName: resolved.packageName,
  };
}
