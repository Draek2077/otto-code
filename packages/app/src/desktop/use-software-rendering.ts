import { useEffect, useState } from "react";
import { isElectronRuntime } from "@/desktop/host";
import { getDesktopRuntimeInfo, type DesktopRuntimeInfo } from "@/desktop/updates/desktop-updates";

// How the desktop shell presents frames (see packages/desktop/src/gpu-fallback.ts
// isSoftwareRenderingActive / isSoftwareCompositingActive). The state is fixed
// for the process lifetime, so it's fetched once and cached module-level; every
// hook instance after the first resolves synchronously. Always hardware on
// native, plain web, and desktop shells that predate the runtime-info fields.
export type DesktopRenderingInfo = Pick<
  DesktopRuntimeInfo,
  "softwareRendering" | "softwareCompositing" | "gpuCompositing"
>;

let cachedRendering: DesktopRenderingInfo | null = null;
let pendingFetch: Promise<DesktopRenderingInfo | null> | null = null;

function fetchRendering(): Promise<DesktopRenderingInfo | null> {
  pendingFetch ??= getDesktopRuntimeInfo()
    .then((info) => {
      cachedRendering = {
        softwareRendering: info.softwareRendering,
        softwareCompositing: info.softwareCompositing,
        gpuCompositing: info.gpuCompositing,
      };
      return cachedRendering;
    })
    .catch(() => {
      // Leave the cache unset so a transient IPC failure can retry on the
      // next mount instead of pinning "hardware" forever.
      pendingFetch = null;
      return null;
    });
  return pendingFetch;
}

/** The cached rendering state, or null before it has resolved (or off desktop). */
export function getCachedDesktopRendering(): DesktopRenderingInfo | null {
  return cachedRendering;
}

/** Resolves the rendering state, fetching it once on desktop. */
export function loadDesktopRendering(): Promise<DesktopRenderingInfo | null> {
  if (cachedRendering !== null || !isElectronRuntime()) {
    return Promise.resolve(cachedRendering);
  }
  return fetchRendering();
}

function useDesktopRenderingFlag(read: (info: DesktopRenderingInfo) => boolean): boolean {
  const [value, setValue] = useState(cachedRendering ? read(cachedRendering) : false);
  useEffect(() => {
    if (cachedRendering !== null || !isElectronRuntime()) {
      return;
    }
    let cancelled = false;
    void fetchRendering().then((info) => {
      if (!cancelled && info && read(info)) {
        setValue(true);
      }
      return info;
    });
    return () => {
      cancelled = true;
    };
    // `read` is a module-level selector at every call site, so this runs once.
  }, [read]);
  return value;
}

const readSoftwareRendering = (info: DesktopRenderingInfo) => info.softwareRendering;
const readSoftwareCompositing = (info: DesktopRenderingInfo) => info.softwareCompositing;

/** Otto's software-rendering fallback is active (marker or software-GL argv). */
export function useIsSoftwareRendering(): boolean {
  return useDesktopRenderingFlag(readSoftwareRendering);
}

/**
 * Chromium composites on the CPU. Every frame with any damage then redraws the
 * whole window in software, so continuous animations must not tick per vsync.
 */
export function useIsSoftwareCompositing(): boolean {
  return useDesktopRenderingFlag(readSoftwareCompositing);
}
