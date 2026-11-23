const fs = require("node:fs");
const path = require("node:path");

exports.verifyZoomRecorder = function verifyZoomRecorder(appOutDir, platform, arch) {
  if (arch !== "x64" || (platform !== "win32" && platform !== "linux")) return;
  const binary = platform === "win32" ? "otto-zoom-recorder.exe" : "otto-zoom-recorder";
  const executable = path.join(appOutDir, "resources", "zoom-recorder", binary);
  const info = fs.statSync(executable, { throwIfNoEntry: false });
  if (!info?.isFile() || info.size === 0) {
    throw new Error(`Bundled Zoom Recorder helper is missing or empty: ${executable}`);
  }
  if (platform === "linux") fs.accessSync(executable, fs.constants.X_OK);
};
