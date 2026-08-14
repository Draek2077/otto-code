const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { Arch } = require("builder-util");

const SUPPORTED_PLATFORMS = new Set(["linux", "win"]);

/**
 * PyInstaller cannot cross-compile the ONNX runtime. Run only for native x64
 * package targets; arm64 packages receive the intentionally empty helper
 * directory and the renderer capability gate hides the feature there.
 */
exports.default = async function buildZoomRecorderForTarget(context) {
  if (context.arch !== Arch.x64 || !SUPPORTED_PLATFORMS.has(context.electronPlatformName)) {
    return;
  }

  const python = process.env.OTTO_ZOOM_RECORDER_PYTHON || "python";
  const script = path.join(
    context.packager.projectDir,
    "scripts",
    "build-zoom-recorder-runtime.py",
  );
  const output = path.join(context.packager.projectDir, "resources", "zoom-recorder", "bin", "x64");
  const result = spawnSync(python, [script, "--output", output], {
    cwd: context.packager.projectDir,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Zoom Recorder helper build failed with exit code ${result.status ?? "unknown"}.`,
    );
  }
};
