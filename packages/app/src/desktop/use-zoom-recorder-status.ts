import { useCallback, useEffect, useState } from "react";
import {
  getDesktopHost,
  type DesktopZoomRecorderStatus,
  type DesktopZoomRecorderState,
} from "@/desktop/host";
import { listenToDesktopEvent } from "@/desktop/electron/events";

const INITIAL_STATUS: DesktopZoomRecorderStatus = {
  available: false,
  enabled: false,
  modelReady: false,
  modelBytes: 0,
  state: "unavailable",
  detail: "Zoom Recorder is unavailable on this desktop build.",
};

function isZoomRecorderStatus(value: unknown): value is DesktopZoomRecorderStatus {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DesktopZoomRecorderStatus>;
  const states: readonly DesktopZoomRecorderState[] = [
    "unavailable",
    "idle",
    "setup",
    "recording",
    "transcribing",
    "ready",
    "error",
  ];
  return (
    typeof candidate.available === "boolean" &&
    typeof candidate.enabled === "boolean" &&
    typeof candidate.modelReady === "boolean" &&
    typeof candidate.modelBytes === "number" &&
    typeof candidate.detail === "string" &&
    states.includes(candidate.state as DesktopZoomRecorderState)
  );
}

export function useZoomRecorderStatus(): {
  status: DesktopZoomRecorderStatus;
  refresh: () => Promise<void>;
} {
  const [status, setStatus] = useState<DesktopZoomRecorderStatus>(INITIAL_STATUS);
  const refresh = useCallback(async () => {
    const next = await getDesktopHost()?.zoomRecorder?.status?.();
    if (isZoomRecorderStatus(next)) setStatus(next);
  }, []);

  useEffect(() => {
    let disposed = false;
    void refresh().catch(() => undefined);
    let unlisten: (() => void) | undefined;
    void listenToDesktopEvent<unknown>("zoom-recorder-status", (payload) => {
      if (!disposed && isZoomRecorderStatus(payload)) setStatus(payload);
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
        return undefined;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refresh]);

  return { status, refresh };
}
