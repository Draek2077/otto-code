import { readFileSync } from "node:fs";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PROBE_BUILD_DIR,
  PROBE_ENTRY_FILE,
  SERVER_PACKAGE_ROOT,
  SERVER_PAYLOAD_DIR,
} from "../../../../../../scripts/dotnet-probe-paths.mjs";
import { payloadCandidates } from "./bootstrap.js";

/**
 * The published-package candidate silently pointed at a directory nothing writes for as long as
 * `bootstrap.ts` existed, because it counted `..` segments against an emitted directory depth
 * that was off by one, and a repo checkout's sibling-package fallback covered for it. So these
 * tests are written to be unable to repeat that mistake:
 *
 * - The **emitted** module directory is derived from `tsconfig.server.json`, not written down. A
 *   guess about emit depth is exactly what broke, and a test that guesses the same way proves
 *   nothing.
 * - The **expected** payload directory is imported from `scripts/dotnet-probe-paths.mjs`, the one
 *   constant `scripts/build-dotnet-probe.mjs` copies to. Two hand-written literals is how the
 *   producer and the consumer drifted apart in the first place.
 *
 * Between them, a change on either side that breaks the other fails here.
 */

const sourceDir = dirname(fileURLToPath(import.meta.url));

interface ServerTsconfig {
  compilerOptions: { outDir: string; rootDir: string };
}

const tsconfig = JSON.parse(
  readFileSync(join(SERVER_PACKAGE_ROOT, "tsconfig.server.json"), "utf8"),
) as ServerTsconfig;

/**
 * Where `tsc` puts this module's compiled sibling, which is the `import.meta.url` a shipped
 * daemon actually resolves against. With `outDir: dist/server` and `rootDir: src`, a source at
 * `src/server/solution-model/dotnet` emits to `dist/server/server/solution-model/dotnet`; the
 * doubled `server/` is the fact the old segment count was wrong about.
 */
const emittedDir = resolve(
  SERVER_PACKAGE_ROOT,
  tsconfig.compilerOptions.outDir,
  relative(resolve(SERVER_PACKAGE_ROOT, tsconfig.compilerOptions.rootDir), sourceDir),
);

describe("payloadCandidates", () => {
  it("looks for the published payload where the build script copies it", () => {
    expect(payloadCandidates(emittedDir, undefined)).toContain(
      join(SERVER_PAYLOAD_DIR, PROBE_ENTRY_FILE),
    );
  });

  it("finds the sibling workspace package a repo checkout builds in place", () => {
    expect(payloadCandidates(emittedDir, undefined)).toContain(
      join(PROBE_BUILD_DIR, PROBE_ENTRY_FILE),
    );
  });

  it("resolves the same payload from source and from the compiled tree", () => {
    // The point of anchoring on the package root rather than counting `..`: running under tsx
    // from `src/` and running the emitted file from `dist/` are different depths, and neither
    // depth may change the answer. This is the assertion the old implementation could not pass.
    expect(payloadCandidates(sourceDir, undefined)).toEqual(
      payloadCandidates(emittedDir, undefined),
    );
  });

  it("puts an explicit override ahead of both derived candidates", () => {
    const override = join(SERVER_PACKAGE_ROOT, "somewhere-else");

    expect(payloadCandidates(emittedDir, override)).toEqual([
      join(override, PROBE_ENTRY_FILE),
      join(SERVER_PAYLOAD_DIR, PROBE_ENTRY_FILE),
      join(PROBE_BUILD_DIR, PROBE_ENTRY_FILE),
    ]);
  });

  it("ignores a blank override rather than probing the working directory", () => {
    expect(payloadCandidates(emittedDir, "   ")).toEqual(payloadCandidates(emittedDir, undefined));
  });
});

describe("the published tarball", () => {
  /**
   * The case that was broken in every shipped build and that a repo checkout could not show: a
   * package with no sibling `packages/dotnet-probe` to fall back on. Built on a real filesystem
   * rather than asserted on strings, because the failure was "every candidate misses", and only
   * `access` can tell you that.
   */
  let installed: string;
  let moduleDir: string;

  beforeEach(async () => {
    installed = await mkdtemp(join(tmpdir(), "otto-dotnet-tarball-"));
    await writeFile(join(installed, "package.json"), '{ "name": "@otto-code/server" }');

    // The layout `npm pack` produces, mirroring this package's own emit depth.
    moduleDir = join(installed, ...relative(SERVER_PACKAGE_ROOT, emittedDir).split(/[/\\]/));
    await mkdir(moduleDir, { recursive: true });

    const payload = join(
      installed,
      ...relative(SERVER_PACKAGE_ROOT, SERVER_PAYLOAD_DIR).split(/[/\\]/),
    );
    await mkdir(payload, { recursive: true });
    await writeFile(join(payload, PROBE_ENTRY_FILE), "IL");
  });

  afterEach(async () => {
    await rm(installed, { recursive: true, force: true });
  });

  it("finds the payload with no sibling workspace package to fall back on", async () => {
    const found: string[] = [];
    for (const candidate of payloadCandidates(moduleDir, undefined)) {
      try {
        await access(candidate, constants.R_OK);
        found.push(candidate);
      } catch {
        continue;
      }
    }

    expect(found).toEqual([
      join(installed, relative(SERVER_PACKAGE_ROOT, SERVER_PAYLOAD_DIR), PROBE_ENTRY_FILE),
    ]);
  });

  it("ships the directory the build script copies the payload into", () => {
    // `files` is an allowlist, so a payload written outside every entry is absent from the
    // tarball no matter what `bootstrap.ts` resolves. Green build, missing feature.
    const manifest = JSON.parse(
      readFileSync(join(SERVER_PACKAGE_ROOT, "package.json"), "utf8"),
    ) as { files: string[] };
    const payloadFromPackageRoot = relative(SERVER_PACKAGE_ROOT, SERVER_PAYLOAD_DIR).replaceAll(
      "\\",
      "/",
    );

    expect(manifest.files).toContain(payloadFromPackageRoot);
  });
});
