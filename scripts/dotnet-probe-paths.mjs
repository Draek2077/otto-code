/**
 * The one place the .NET sidecar's on-disk locations are written down.
 *
 * These used to be hand-written path literals in three files, and they drifted. `bootstrap.ts`
 * located the published payload by counting `..` segments up from its own module directory, which
 * silently encodes how deep TypeScript emits. It emits one level deeper than the comment there
 * assumed, so the published-package candidate resolved to `dist/server/dotnet-probe`, which
 * nothing writes, while `build-dotnet-probe.mjs` writes `dist/dotnet-probe`. A repo checkout hid
 * it, because a later fallback found the sibling `packages/dotnet-probe/dist`. The Solution view
 * therefore worked here and was permanently unavailable in a published tarball or the installed
 * app.
 *
 * `bootstrap.ts` cannot import this file (it has to work from inside a published package, where
 * `scripts/` does not exist), so it derives its candidates from the server package root instead of
 * counting segments. `bootstrap.test.ts` imports this module and asserts that derivation lands
 * exactly on `SERVER_PAYLOAD_DIR`, which is what keeps the two sides from drifting again.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The payload's entry assembly. The daemon spawns `dotnet <this>`. */
export const PROBE_ENTRY_FILE = "OttoDotnetProbe.dll";

export const PROBE_PACKAGE_DIR = join(REPO_ROOT, "packages", "dotnet-probe");
export const PROBE_PROJECT_PATH = join(PROBE_PACKAGE_DIR, "OttoDotnetProbe.csproj");
export const PROBE_FIXTURES_DIR = join(PROBE_PACKAGE_DIR, "fixtures", "sample");

/** Where `dotnet publish` lands, and what a repo checkout runs against. */
export const PROBE_BUILD_DIR = join(PROBE_PACKAGE_DIR, "dist");

export const SERVER_PACKAGE_ROOT = join(REPO_ROOT, "packages", "server");
export const SERVER_DIST_DIR = join(SERVER_PACKAGE_ROOT, "dist");

/**
 * The published-package location: the payload copied inside the server package so that a tarball
 * and the installed desktop app carry it. This has to stay covered by that package's `files`
 * array, which is an allowlist. A payload written outside every entry ships nothing, and does it
 * with a green build.
 */
export const SERVER_PAYLOAD_DIR = join(SERVER_DIST_DIR, "dotnet-probe");
