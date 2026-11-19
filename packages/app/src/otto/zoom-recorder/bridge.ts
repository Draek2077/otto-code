export type ZoomRecorderState =
  | "unavailable"
  | "idle"
  | "setup"
  | "recording"
  | "transcribing"
  | "ready"
  | "error";

export interface ZoomRecorderStatus {
  available: boolean;
  enabled: boolean;
  modelReady: boolean;
  modelBytes: number;
  state: ZoomRecorderState;
  detail: string;
}

export interface LocalMeetingNote {
  id: string;
  title: string;
  occurredAt: string;
  content: string;
}

export interface ZoomRecorderBridge {
  status(): Promise<ZoomRecorderStatus>;
  enable(): Promise<ZoomRecorderStatus>;
  disable(): Promise<ZoomRecorderStatus>;
  deleteModel(): Promise<ZoomRecorderStatus>;
  listTranscripts(): Promise<LocalMeetingNote[]>;
  updateTranscript(input: {
    id: string;
    title?: string;
    content?: string;
  }): Promise<LocalMeetingNote | null>;
  deleteTranscript(id: string): Promise<boolean>;
}
