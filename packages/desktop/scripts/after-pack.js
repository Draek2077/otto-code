const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");

const { smokePackagedDesktopApp } = require("../e2e/packaged-app-smoke.js");

const EXECUTABLE_NAME = "Otto";

// electron-builder arch enum → Node.js arch string
const ARCH_MAP = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" };

const RIPGREP_PLATFORM_DIR = {
  darwin: { arm64: "arm64-darwin", x64: "x64-darwin" },
  linux: { arm64: "arm64-linux", x64: "x64-linux" },
  win32: { arm64: "arm64-win32", x64: "x64-win32" },
};

function getResourcesDir(appOutDir, platform) {
  return platform === "darwin"
    ? path.join(appOutDir, `${EXECUTABLE_NAME}.app`, "Contents", "Resources")
    : path.join(appOutDir, "resources");
}

function verifyBundledWakeWordModel(appOutDir, platform) {
  const modelDir = path.join(getResourcesDir(appOutDir, platform), "wake-word");
  const manifestPath = path.join(modelDir, "model.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Bundled wake-word manifest is missing: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const assetNames = Object.values(manifest.assets || {});
  if (assetNames.length === 0) {
    throw new Error(`Bundled wake-word manifest has no assets: ${manifestPath}`);
  }
  for (const legalFile of ["LICENSE-APACHE-2.0.txt", "THIRD_PARTY_NOTICES.md"]) {
    const legalPath = path.join(modelDir, legalFile);
    if (!fs.existsSync(legalPath)) {
      throw new Error(`Bundled wake-word legal notice is missing: ${legalPath}`);
    }
  }

  for (const assetName of assetNames) {
    if (typeof assetName !== "string") {
      throw new Error(`Bundled wake-word manifest has an invalid asset name: ${manifestPath}`);
    }
    const assetPath = path.join(modelDir, assetName);
    if (!fs.existsSync(assetPath)) {
      throw new Error(`Bundled wake-word asset is missing: ${assetPath}`);
    }

    const expectedBytes = manifest.assetBytes?.[assetName];
    const actualBytes = fs.statSync(assetPath).size;
    if (actualBytes !== expectedBytes) {
      throw new Error(
        `Bundled wake-word asset size mismatch for ${assetName}: expected ${expectedBytes}, got ${actualBytes}`,
      );
    }

    const expectedSha256 = manifest.assetSha256?.[assetName];
    const actualSha256 = createHash("sha256").update(fs.readFileSync(assetPath)).digest("hex");
    if (actualSha256 !== expectedSha256) {
      throw new Error(
        `Bundled wake-word asset checksum mismatch for ${assetName}: expected ${expectedSha256}, got ${actualSha256}`,
      );
    }
  }

  console.log(`Verified bundled wake-word model: ${assetNames.length} assets`);
}

function rmSafe(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function pruneChildrenExcept(parent, keep) {
  if (!fs.existsSync(parent)) return;
  for (const entry of fs.readdirSync(parent)) {
    if (!keep.has(entry)) {
      rmSafe(path.join(parent, entry));
    }
  }
}

function pruneClaudeAgentSdk(nodeModules, platform, arch) {
  const vendorRoot = path.join(nodeModules, "@anthropic-ai", "claude-agent-sdk", "vendor");
  const keepName = RIPGREP_PLATFORM_DIR[platform]?.[arch];
  if (keepName) {
    pruneChildrenExcept(path.join(vendorRoot, "ripgrep"), new Set(["COPYING", keepName]));
    pruneChildrenExcept(path.join(vendorRoot, "tree-sitter-bash"), new Set([keepName]));
  }

  // SDK ≥0.2.113 ships per-platform Claude Code binaries via optionalDependencies
  // (~210 MB each). Otto requires user-installed `claude` on PATH, matching how
  // Codex/OpenCode are integrated, so drop every bundled copy.
  const anthropicDir = path.join(nodeModules, "@anthropic-ai");
  if (fs.existsSync(anthropicDir)) {
    for (const entry of fs.readdirSync(anthropicDir)) {
      if (entry.startsWith("claude-agent-sdk-")) {
        rmSafe(path.join(anthropicDir, entry));
      }
    }
  }
}

function pruneNodePty(nodeModules, platform, arch) {
  const prebuilds = path.join(nodeModules, "node-pty", "prebuilds");
  pruneChildrenExcept(prebuilds, new Set([`${platform}-${arch}`]));

  if (platform !== "win32") {
    rmSafe(path.join(nodeModules, "node-pty", "third_party"));
  }
}

function pruneSharpLibvips(nodeModules, platform, arch) {
  const prefix = `sharp-libvips-${platform}-${arch}`;
  const imgDir = path.join(nodeModules, "@img");
  if (!fs.existsSync(imgDir)) return;

  for (const entry of fs.readdirSync(imgDir)) {
    if (
      entry.startsWith("sharp-") &&
      entry !== prefix &&
      !entry.startsWith(`sharp-${platform}-${arch}`)
    ) {
      rmSafe(path.join(imgDir, entry));
    }
  }
}

function pruneNativeModules(appOutDir, platform, arch) {
  const resourcesDir = getResourcesDir(appOutDir, platform);

  const nodeModules = path.join(resourcesDir, "app.asar.unpacked", "node_modules");
  if (!fs.existsSync(nodeModules)) return;

  const before = dirSizeSync(nodeModules);

  pruneClaudeAgentSdk(nodeModules, platform, arch);
  pruneNodePty(nodeModules, platform, arch);
  pruneSharpLibvips(nodeModules, platform, arch);

  const after = dirSizeSync(nodeModules);
  const savedMB = ((before - after) / 1024 / 1024).toFixed(1);
  console.log(`Pruned native modules: ${savedMB} MB removed (${fmtMB(before)} → ${fmtMB(after)})`);
}

function dirSizeSync(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) {
      try {
        total += fs.statSync(path.join(entry.parentPath || entry.path, entry.name)).size;
      } catch {}
    }
  }
  return total;
}

function fmtMB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName;
  const arch = ARCH_MAP[context.arch] || process.arch;

  verifyBundledWakeWordModel(context.appOutDir, platform);
  pruneNativeModules(context.appOutDir, platform, arch);

  if (platform === "linux" || platform === "win32") {
    if (arch !== process.arch) {
      console.log(
        `Skipping packaged-app smoke: build arch ${arch} differs from host ${process.arch}.`,
      );
    } else {
      await smokeUnpackedAppIfRequested(context.appOutDir);
    }
  }
};

exports.verifyBundledWakeWordModel = verifyBundledWakeWordModel;

async function smokeUnpackedAppIfRequested(appOutDir) {
  if (process.env.OTTO_DESKTOP_SMOKE !== "1") {
    return;
  }

  await smokePackagedDesktopApp({
    appPath: appOutDir,
  });
}
