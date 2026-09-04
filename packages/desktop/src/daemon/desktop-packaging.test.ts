import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// electron-builder lifecycle hooks are CommonJS scripts, so exercise their
// exported packaging assertions directly rather than duplicating the check in
// a declarative-config test.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { verifyBundledZoomRecorder } = require("../../scripts/after-pack.js") as {
  verifyBundledZoomRecorder: (appOutDir: string, platform: NodeJS.Platform, arch: string) => void;
};

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function writeExecutable(filePath: string, contents: string): void {
  writeFileSync(filePath, contents, "utf8");
  chmodSync(filePath, 0o755);
}

function createFakeMacBundle(options: { includeHelper: boolean }): {
  root: string;
  shimPath: string;
} {
  const root = mkdtempSync(join(tmpdir(), "otto-cli-shim-test-"));
  const appPath = join(root, "Otto.app");
  const contentsPath = join(appPath, "Contents");
  const resourcesPath = join(contentsPath, "Resources");
  const shimPath = join(resourcesPath, "bin", "otto");
  const mainPath = join(contentsPath, "MacOS", "Otto");
  const helperPath = join(
    contentsPath,
    "Frameworks",
    "Otto Helper.app",
    "Contents",
    "MacOS",
    "Otto Helper",
  );

  mkdirSync(dirname(shimPath), { recursive: true });
  mkdirSync(dirname(mainPath), { recursive: true });
  copyFileSync(join(packageRoot, "bin", "otto"), shimPath);
  chmodSync(shimPath, 0o755);

  writeExecutable(mainPath, "#!/bin/sh\necho main-executable\n");

  if (options.includeHelper) {
    mkdirSync(dirname(helperPath), { recursive: true });
    writeExecutable(
      helperPath,
      [
        "#!/bin/sh",
        'printf "helper env=%s/%s cli=%s\\n" "$ELECTRON_RUN_AS_NODE" "$OTTO_NODE_ENV" "$OTTO_CLI"',
        'printf "args=%s\\n" "$*"',
        "",
      ].join("\n"),
    );
  }

  return { root, shimPath };
}

describe("desktop packaging", () => {
  it("bundles a checksum-pinned wake-word model in every installer", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");
    expect(config).toContain("from: ../expo-two-way-audio/models/wake-word");
    expect(config).toContain("from: ../expo-two-way-audio/wake-word-model.json");
    expect(config).toContain("to: wake-word/model.json");
    expect(config).toContain("to: wake-word/LICENSE-APACHE-2.0.txt");

    const sharedPackageRoot = join(packageRoot, "..", "expo-two-way-audio");
    const manifest = JSON.parse(
      readFileSync(join(sharedPackageRoot, "wake-word-model.json"), "utf8"),
    ) as {
      assets: Record<string, string>;
      assetBytes: Record<string, number>;
      assetSha256: Record<string, string>;
      androidRuntime: {
        file: string;
        bytes: number;
        sha256: string;
      };
    };

    expect(Object.keys(manifest.assets)).toEqual([
      "encoder",
      "decoder",
      "joiner",
      "tokens",
      "keywords",
    ]);
    for (const assetName of Object.values(manifest.assets)) {
      const assetPath = join(sharedPackageRoot, "models", "wake-word", assetName);
      expect(existsSync(assetPath), `${assetName} must be checked in`).toBe(true);
      const asset = readFileSync(assetPath);
      expect(asset.byteLength, `${assetName} byte length`).toBe(manifest.assetBytes[assetName]);
      expect(createHash("sha256").update(asset).digest("hex"), `${assetName} checksum`).toBe(
        manifest.assetSha256[assetName],
      );
    }

    const androidRuntimePath = join(sharedPackageRoot, manifest.androidRuntime.file);
    const androidRuntime = readFileSync(androidRuntimePath);
    expect(androidRuntime.byteLength, "Android Sherpa AAR byte length").toBe(
      manifest.androidRuntime.bytes,
    );
    expect(
      createHash("sha256").update(androidRuntime).digest("hex"),
      "Android Sherpa AAR checksum",
    ).toBe(manifest.androidRuntime.sha256);

    const androidBuild = readFileSync(join(sharedPackageRoot, "android", "build.gradle"), "utf8");
    // AGP forbids a local .aar file dependency in a library module, so the pinned
    // runtime is unpacked into a plain classes.jar at build time. Assert both ends:
    // the AAR the checksum above covers is still the source, and the jar derived
    // from it is what the module compiles against.
    expect(androidBuild).toContain('file("libs/sherpa-onnx-1.12.28.aar")');
    expect(androidBuild).toContain(
      'implementation files("$buildDir/generated/sherpa-onnx/classes.jar")',
    );
    expect(androidBuild).toContain('assets.srcDir file("../models")');
    expect(androidBuild).toContain('tasks.register("verifyWakeWordDistribution")');
  });

  it("points the Nix launcher at the same checked-in wake-word model", () => {
    const nixPackage = readFileSync(
      join(packageRoot, "..", "..", "nix", "desktop-package.nix"),
      "utf8",
    );
    expect(nixPackage).toContain(
      '--set OTTO_WAKE_WORD_MODEL_DIR "$out/share/otto-desktop/packages/expo-two-way-audio/models/wake-word"',
    );
    expect(nixPackage).toContain("models/wake-word/LICENSE-APACHE-2.0.txt");
  });

  it("unpacks server zsh shell integration files for external shells", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");

    expect(config).toContain(
      "node_modules/@otto-code/server/dist/server/terminal/shell-integration/**/*",
    );
    expect(config).not.toContain(
      "node_modules/@otto-code/server/dist/src/terminal/shell-integration/**/*",
    );
  });

  it("builds and bundles the native Zoom Recorder helper only on supported x64 release targets", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");
    const beforePack = readFileSync(join(packageRoot, "scripts", "before-pack.js"), "utf8");
    const buildRuntime = readFileSync(
      join(packageRoot, "scripts", "build-zoom-recorder-runtime.py"),
      "utf8",
    );

    expect(config).toContain("beforePack: ./scripts/before-pack.js");
    expect(config).toContain("from: resources/zoom-recorder/bin/${arch}");
    expect(config).toContain("to: zoom-recorder");
    expect(beforePack).toContain('new Set(["linux", "win"])');
    expect(beforePack).toContain("context.arch !== Arch.x64");
    expect(beforePack).toContain('"build-zoom-recorder-runtime.py"');
    expect(beforePack).toContain('"bin", "x64"');
    expect(buildRuntime).toContain('OUTPUT_ROOT = HELPER_ROOT / "bin" / "x64"');
    expect(buildRuntime).toContain('system not in {"Linux", "Windows"}');
    expect(buildRuntime).toContain("smoke_test(executable)");
    expect(buildRuntime).toContain('("--version",), ("status",)');
  });

  it("rejects a supported package when its Zoom Recorder helper is missing", () => {
    const appOutDir = mkdtempSync(join(tmpdir(), "otto-recorder-package-test-"));
    try {
      expect(() => verifyBundledZoomRecorder(appOutDir, "win32", "x64")).toThrow(
        "Bundled Zoom Recorder helper is missing",
      );

      const helperPath = join(appOutDir, "resources", "zoom-recorder", "otto-zoom-recorder.exe");
      mkdirSync(dirname(helperPath), { recursive: true });
      writeFileSync(helperPath, "frozen helper");

      expect(() => verifyBundledZoomRecorder(appOutDir, "win32", "x64")).not.toThrow();
      expect(() => verifyBundledZoomRecorder(appOutDir, "win32", "arm64")).not.toThrow();
    } finally {
      rmSync(appOutDir, { recursive: true, force: true });
    }
  });

  it("excludes package debug/source files from the packaged app", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");

    expect(config).toContain("!**/*.map");
    expect(config).toContain("!node_modules/@otto-code/*/src/**");
    expect(config).toContain("!node_modules/@otto-code/**/*.test.*");
    expect(config).toContain("!node_modules/@otto-code/**/*.spec.*");
  });

  it("excludes the bundled daemon web UI from the packaged app", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");

    expect(config).toContain("!node_modules/@otto-code/server/dist/server/web-ui/**");
  });

  it("uses the server skill catalog without a duplicate desktop resource", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");
    const serverPackage = readFileSync(join(packageRoot, "..", "server", "package.json"), "utf8");
    const runtimeTrace = readFileSync(
      join(packageRoot, "..", "..", "scripts", "trace-daemon.mjs"),
      "utf8",
    );

    expect(config).not.toContain("from: ../../skills");
    expect(serverPackage).toContain("fs.rmSync('dist/server/skills',{recursive:true,force:true})");
    expect(serverPackage).toContain("fs.cpSync('../../skills','dist/server/skills'");
    expect(runtimeTrace).toContain('"packages/server/dist/server/skills/**"');
  });

  it("registers Otto agent links with the operating system", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");

    expect(config).toContain("name: Otto agent link");
    expect(config).toContain("- otto");
  });

  // electron-builder packs production dependencies declared in package.json into
  // app.asar. Runtime code in runtime-paths.ts and bin/otto dynamically resolves
  // these workspace packages by string, so static analysis (TypeScript, Knip) cannot
  // see the link. If a runtime-required workspace dep is dropped from
  // dependencies, the build still succeeds but ships a broken bundle. This
  // assertion is the safety net.
  it("declares all workspace packages required at runtime", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const deps = pkg.dependencies ?? {};

    for (const required of ["@otto-code/cli", "@otto-code/server"]) {
      expect(deps[required], `${required} must be declared in dependencies`).toBe("*");
    }
  });

  it("launches the packaged macOS CLI through Helper instead of the main app executable", () => {
    if (process.platform === "win32") return;

    const bundle = createFakeMacBundle({ includeHelper: true });
    try {
      const result = spawnSync(bundle.shimPath, ["--version"], { encoding: "utf8" });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`helper env=1/production cli=${bundle.shimPath}`);
      expect(result.stdout).toContain("node-entrypoint-runner.js");
      expect(result.stdout).toContain("node-script");
      expect(result.stdout).toContain("@otto-code/cli/dist/index.js");
      expect(result.stdout).toContain("--version");
      expect(result.stdout).not.toContain("main-executable");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("fails packaged macOS CLI startup when Helper is missing", () => {
    if (process.platform === "win32") return;

    const bundle = createFakeMacBundle({ includeHelper: false });
    try {
      const result = spawnSync(bundle.shimPath, ["--version"], { encoding: "utf8" });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Bundled Otto Helper executable not found");
      expect(result.stdout).not.toContain("main-executable");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });
});
