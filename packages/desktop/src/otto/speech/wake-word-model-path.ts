import path from "node:path";

interface WakeWordModelPathOptions {
  configured?: string;
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
}

export function resolveWakeWordModelDir(options: WakeWordModelPathOptions): string {
  const configured = options.configured?.trim();
  if (configured) return path.resolve(configured);

  if (options.isPackaged) {
    return path.join(options.resourcesPath, "wake-word");
  }

  return path.resolve(options.appPath, "../expo-two-way-audio/models/wake-word");
}
