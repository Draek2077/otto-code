import { SpeechFileWatchdog, completeFilePlayback } from "@/otto/speech/file-watchdog"; // OTTO(speech): system pause/resume shares the existing file player.
export interface FilePlaybackStatus {
  playing?: boolean; // OTTO(speech)
  currentTime?: number; // OTTO(speech)
  playbackState: string;
  isLoaded: boolean;
  didJustFinish: boolean;
  duration: number;
}

export interface FilePlayer {
  play(): void;
  remove(): void;
  addListener(
    event: "playbackStatusUpdate",
    listener: (status: FilePlaybackStatus) => void,
  ): { remove(): void };
}

/** Own completion, load failure and resource release for the native file backend. */
export function playFile(player: FilePlayer, signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;
    // expo-audio 1.x does not report Android decoder errors. A local file that
    // never becomes loaded must still release its queue slot and temporary file.
    const watchdog = new SpeechFileWatchdog((error) => finish(error)); // OTTO(speech)
    const finish = (error?: unknown, duration = 0) => {
      if (settled) return;
      settled = true;
      watchdog.close(); // OTTO(speech)
      signal.removeEventListener("abort", abort);
      const failure = completeFilePlayback(
        error,
        () => subscription.remove(),
        () => player.remove(),
      ); // OTTO(speech): cleanup cannot leave the queue promise pending.
      if (failure) reject(failure);
      else resolve(duration);
    };
    const abort = () => finish(new Error("Playback stopped"));
    const subscription = player.addListener("playbackStatusUpdate", (status) => {
      if (status.playbackState === "error" || status.playbackState === "failed") {
        finish(new Error("Audio file could not be decoded"));
      } else if (status.didJustFinish) {
        finish(undefined, status.duration);
      } else watchdog.update(status); // OTTO(speech)
    });
    watchdog.start(); // OTTO(speech)
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else {
      try {
        player.play();
      } catch (error) {
        finish(error);
      }
    }
  });
}
