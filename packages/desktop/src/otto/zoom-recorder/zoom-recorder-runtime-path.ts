import path from "node:path";

interface ZoomRecorderRuntimePathOptions {
  configured?: string;
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  platform: NodeJS.Platform;
}

export function resolveZoomRecorderRuntimePath(options: ZoomRecorderRuntimePathOptions): string {
  const configured = options.configured?.trim();
  if (configured) return path.resolve(configured);

  const executableName =
    options.platform === "win32" ? "otto-zoom-recorder.exe" : "otto-zoom-recorder";
  const root = options.isPackaged
    ? path.join(options.resourcesPath, "zoom-recorder")
    : path.join(options.appPath, "resources", "zoom-recorder", "bin", "x64");

  return path.join(root, executableName);
}
