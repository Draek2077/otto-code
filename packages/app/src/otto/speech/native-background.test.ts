import { afterEach, describe, expect, it, vi } from "vitest";
import { playFile, type FilePlaybackStatus } from "@/audio/file-playback";
import { SpeechFileWatchdog } from "./file-watchdog";
import { speechBackgroundPlayer } from "./native-background";
afterEach(() => vi.useRealTimers());
function playerFixture() {
  let listener: ((status: FilePlaybackStatus) => void) | null = null;
  const calls: string[] = [];
  const player = {
    play() {
      calls.push("play");
    },
    remove() {
      calls.push("remove");
    },
    addListener(_event: "playbackStatusUpdate", next: (status: FilePlaybackStatus) => void) {
      listener = next;
      return {
        remove() {
          listener = null;
        },
      };
    },
    setActiveForLockScreen(_active: boolean, metadata: { title: string }) {
      calls.push(`lock:${metadata.title}`);
    },
    clearLockScreenControls() {
      calls.push("clear");
    },
  };
  return {
    player,
    calls,
    status: (patch: Partial<FilePlaybackStatus>) =>
      listener?.({
        playbackState: "ready",
        isLoaded: true,
        didJustFinish: false,
        duration: 5,
        playing: true,
        currentTime: 0,
        ...patch,
      }),
  };
}
describe("native background speech ownership", () => {
  it("uses generic system playback controls and clears them before releasing the existing player", async () => {
    const f = playerFixture();
    const playing = playFile(speechBackgroundPlayer(f.player), new AbortController().signal);
    expect(f.calls).toEqual(["lock:Otto speech", "play"]);
    f.status({ didJustFinish: true });
    expect(await playing).toBe(5);
    expect(f.calls).toEqual(["lock:Otto speech", "play", "clear", "remove"]);
  });
  it("cancels once and ignores completion arriving after cancellation", async () => {
    const f = playerFixture();
    const controller = new AbortController();
    const playing = playFile(speechBackgroundPlayer(f.player), controller.signal);
    const stopped = expect(playing).rejects.toThrow("Playback stopped");
    controller.abort();
    await stopped;
    f.status({ didJustFinish: true });
    expect(f.calls).toEqual(["lock:Otto speech", "play", "clear", "remove"]);
  });
  it("retains cleanup failure diagnostics while still removing the native player and settling playback", async () => {
    const f = playerFixture();
    const error = new Error("fixture controls failed");
    f.player.clearLockScreenControls = () => {
      throw error;
    };
    const playing = playFile(speechBackgroundPlayer(f.player), new AbortController().signal);
    const failed = expect(playing).rejects.toBe(error);
    f.status({ didJustFinish: true });
    await failed;
    expect(f.calls).toContain("remove");
  });
  it("does not treat a system pause as a timeout, and resumes the remaining-audio watchdog", () => {
    vi.useFakeTimers();
    const fail = vi.fn();
    const watchdog = new SpeechFileWatchdog(fail);
    watchdog.start();
    watchdog.update({
      playbackState: "ready",
      isLoaded: true,
      didJustFinish: false,
      duration: 5,
      playing: true,
      currentTime: 0,
    });
    watchdog.update({
      playbackState: "ready",
      isLoaded: true,
      didJustFinish: false,
      duration: 5,
      playing: false,
      currentTime: 1,
    });
    vi.advanceTimersByTime(120000);
    expect(fail).not.toHaveBeenCalled();
    watchdog.update({
      playbackState: "ready",
      isLoaded: true,
      didJustFinish: false,
      duration: 5,
      playing: true,
      currentTime: 1,
    });
    vi.advanceTimersByTime(33999);
    expect(fail).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fail).toHaveBeenCalledTimes(1);
  });
  it("fails a file that never loads, while closing a successful watchdog removes its timer", () => {
    vi.useFakeTimers();
    const fail = vi.fn();
    const loading = new SpeechFileWatchdog(fail);
    loading.start();
    vi.advanceTimersByTime(15000);
    expect(fail.mock.calls[0]![0].message).toBe("Audio file could not be loaded");
    const complete = new SpeechFileWatchdog(fail);
    complete.start();
    complete.close();
    vi.advanceTimersByTime(60000);
    expect(fail).toHaveBeenCalledTimes(1);
  });
});
