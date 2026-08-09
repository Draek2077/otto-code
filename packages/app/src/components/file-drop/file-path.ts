import type { DesktopHostBridge } from "@/desktop/host";

function legacyFilePath(file: File): string | null {
  const path = Reflect.get(file, "path");
  return typeof path === "string" && path.length > 0 ? path : null;
}

/** Returns a host filesystem path for an Electron drop, if the browser exposes one. */
export function getDroppedFilePath(file: File, bridge: DesktopHostBridge | null): string | null {
  try {
    const path = bridge?.webUtils?.getPathForFile?.(file);
    if (typeof path === "string" && path.length > 0) return path;
  } catch {
    // Older Electron shells may expose File.path instead.
  }
  return legacyFilePath(file);
}
