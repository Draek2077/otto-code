import type { DesktopHostBridge } from "@/desktop/host";

/**
 * Zoom Recorder embeds native audio capture and a frozen ONNX runtime. It is
 * intentionally unavailable until Otto ships a helper built for that CPU
 * architecture instead of risking an incompatible executable.
 */
export function supportsZoomRecorder(host: DesktopHostBridge | null): boolean {
  return host?.arch === "x64" && (host.platform === "linux" || host.platform === "win32");
}
