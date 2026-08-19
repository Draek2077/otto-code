const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { Arch } = require("builder-util");

const SUPPORTED_PLATFORMS = new Set(["linux", "win"]);
const VENV_DIR = ".venv-zoom-recorder";

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
  }
}

function findSystemPython() {
  // Windows installs expose the `py` launcher; most Linux/macOS ship `python3`.
  const candidates =
    process.platform === "win32" ? ["py", "python", "python3"] : ["python3", "python"];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (!probe.error && probe.status === 0) {
      return candidate;
    }
  }
  throw new Error(
    "Python 3 is required to build the Zoom Recorder helper but was not found on PATH. " +
      "Install Python 3, or point OTTO_ZOOM_RECORDER_PYTHON at an interpreter that has " +
      "resources/zoom-recorder/requirements-build.txt installed.",
  );
}

/**
 * Provision a checkout-local venv holding the helper's pinned build
 * dependencies, so packaging works on a fresh machine with only Python
 * installed. OTTO_ZOOM_RECORDER_PYTHON overrides and skips provisioning.
 */
function ensureVenvPython(projectDir) {
  const venvPython = path.join(
    projectDir,
    VENV_DIR,
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  if (!existsSync(venvPython)) {
    run(findSystemPython(), ["-m", "venv", path.join(projectDir, VENV_DIR)], { cwd: projectDir });
  }
  const requirements = path.join(
    projectDir,
    "resources",
    "zoom-recorder",
    "requirements-build.txt",
  );
  run(venvPython, ["-m", "pip", "install", "--quiet", "-r", requirements], { cwd: projectDir });
  return venvPython;
}

/**
 * PyInstaller cannot cross-compile the ONNX runtime. Run only for native x64
 * package targets; arm64 packages receive the intentionally empty helper
 * directory and the renderer capability gate hides the feature there.
 */
exports.default = async function buildZoomRecorderForTarget(context) {
  if (context.arch !== Arch.x64 || !SUPPORTED_PLATFORMS.has(context.electronPlatformName)) {
    return;
  }

  const projectDir = context.packager.projectDir;
  const python = process.env.OTTO_ZOOM_RECORDER_PYTHON || ensureVenvPython(projectDir);
  const script = path.join(projectDir, "scripts", "build-zoom-recorder-runtime.py");
  const output = path.join(projectDir, "resources", "zoom-recorder", "bin", "x64");
  run(python, [script, "--output", output], { cwd: projectDir });
};
