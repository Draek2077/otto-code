import type { FilePlaybackStatus } from "@/audio/file-playback";
/** Loading/decoder failures still settle. A user-paused lock-screen player is
 * deliberately not a timeout; resuming arms a watchdog for the remaining audio.
 */
export class SpeechFileWatchdog {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private loaded = false;
  private playing = false;
  private seenPlaying = false;
  private closed = false;
  constructor(private readonly fail: (error: Error) => void) {}
  private arm(delay: number, message: string) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.close();
      this.fail(new Error(message));
    }, delay);
  }
  start() {
    this.arm(15000, "Audio file could not be loaded");
  }
  update(status: FilePlaybackStatus) {
    if (this.closed || !status.isLoaded || status.duration <= 0) return;
    const remaining = Math.max(0, status.duration - (status.currentTime ?? 0));
    if (!this.loaded) {
      this.loaded = true;
      this.arm((remaining + 30) * 1000, "Audio playback timed out");
    }
    if (status.playing === true) {
      if (this.seenPlaying && !this.playing)
        this.arm((remaining + 30) * 1000, "Audio playback timed out");
      this.seenPlaying = true;
      this.playing = true;
    } else if (status.playing === false && this.seenPlaying) {
      this.playing = false;
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}

export function completeFilePlayback(
  error: unknown,
  unsubscribe: () => void,
  remove: () => void,
): unknown {
  const errors: unknown[] = error ? [error] : [];
  for (const cleanup of [unsubscribe, remove]) {
    try {
      cleanup();
    } catch (failure) {
      errors.push(failure);
    }
  }
  if (errors.length === 0) return null;
  if (errors.length === 1) return errors[0];
  return new AggregateError(errors, "Audio playback and resource cleanup failed.", {
    cause: errors[0],
  });
}
