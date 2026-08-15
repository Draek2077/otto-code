import type { DesktopZoomRecorderState } from "@/desktop/host";

export type ZoomMeetingTitlebarTone = "muted" | "success" | "warning" | "info" | "danger";

export interface ZoomMeetingTitlebarState {
  label: string;
  tone: ZoomMeetingTitlebarTone;
}

/**
 * Meeting capture is local desktop state, not Team Chat state. Keep this
 * mapping independent so the title-bar icon can be trusted at a glance.
 */
export function getZoomMeetingTitlebarState(
  state: DesktopZoomRecorderState,
  modelReady = false,
): ZoomMeetingTitlebarState {
  // The helper can leave its previous download state in the advisory status
  // file while a resumed watcher starts. A ready model means that is not a
  // download in progress, so the title bar must return to Detecting at once.
  const resolvedState = state === "setup" && modelReady ? "idle" : state;
  switch (resolvedState) {
    case "idle":
      return { label: "Detecting", tone: "success" };
    case "recording":
      return { label: "Recording", tone: "danger" };
    case "transcribing":
      return { label: "Transcribing", tone: "warning" };
    case "ready":
      return { label: "Ready", tone: "info" };
    case "setup":
      return { label: "Downloading", tone: "warning" };
    case "error":
      return { label: "Error", tone: "danger" };
    case "unavailable":
      return { label: "Unavailable", tone: "muted" };
  }
}
