import { useEffect, useState } from "react";
import { getDesktopHost } from "@/desktop/host";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import type { ZoomRecorderStatus } from "./bridge";

export function useZoomRecorderStatus() {
  const bridge = getDesktopHost()?.zoomRecorder;
  const [status, setStatus] = useState<ZoomRecorderStatus | null>(null);
  useEffect(() => {
    if (!bridge) return;
    let disposed = false;
    let observed = false;
    let unsubscribe: (() => void) | undefined;
    void listenToDesktopEvent<ZoomRecorderStatus>("zoom-recorder-status", (snapshot) => {
      if (disposed) return;
      observed = true;
      setStatus(snapshot);
    })
      .then((stop) => {
        if (disposed) {
          stop();
          return;
        }
        unsubscribe = stop;
        return bridge.status().then((snapshot) => {
          if (!disposed && !observed) setStatus(snapshot);
          return undefined;
        });
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [bridge]);
  return { bridge, status };
}
