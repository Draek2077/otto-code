import { useEffect, useState } from "react";
import { isElectronRuntime } from "@/desktop/host";
import { getDesktopRuntimeInfo } from "@/desktop/updates/desktop-updates";

// Whether the desktop shell is presenting frames without GPU acceleration
// (the gpu-fallback marker/flags or explicit software-GL argv — see
// packages/desktop/src/gpu-fallback.ts isSoftwareRenderingActive). The state
// is fixed for the process lifetime, so it's fetched once and cached
// module-level; every hook instance after the first resolves synchronously.
// Always false on native, plain web, and desktop shells that predate the
// runtime-info field.
let cachedSoftwareRendering: boolean | null = null;
let pendingFetch: Promise<boolean> | null = null;

function fetchSoftwareRendering(): Promise<boolean> {
  pendingFetch ??= getDesktopRuntimeInfo()
    .then((info) => {
      cachedSoftwareRendering = info.softwareRendering;
      return cachedSoftwareRendering;
    })
    .catch(() => {
      // Leave the cache unset so a transient IPC failure can retry on the
      // next mount instead of pinning "hardware" forever.
      pendingFetch = null;
      return false;
    });
  return pendingFetch;
}

export function useIsSoftwareRendering(): boolean {
  const [value, setValue] = useState(cachedSoftwareRendering ?? false);
  useEffect(() => {
    if (cachedSoftwareRendering !== null || !isElectronRuntime()) {
      return;
    }
    let cancelled = false;
    void fetchSoftwareRendering().then((softwareRendering) => {
      if (!cancelled && softwareRendering) {
        setValue(true);
      }
      return softwareRendering;
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return value;
}
