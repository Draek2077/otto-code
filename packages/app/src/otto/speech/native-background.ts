import type { FilePlayer } from "@/audio/file-playback";
import { completeFilePlayback } from "./file-watchdog";
/** One existing player, generic lock-screen metadata, no microphone/recorder or
 * second playback engine. Stop and failure release controls before the player.
 */
interface BackgroundFilePlayer extends FilePlayer {
  setActiveForLockScreen(
    active: boolean,
    metadata: { title: string; artist: string },
    options: { showSeekForward: boolean; showSeekBackward: boolean },
  ): void;
  clearLockScreenControls(): void;
}
export function speechBackgroundPlayer(player: BackgroundFilePlayer): FilePlayer {
  return {
    play() {
      player.setActiveForLockScreen(
        true,
        { title: "Otto speech", artist: "Otto" },
        { showSeekForward: false, showSeekBackward: false },
      );
      player.play();
    },
    addListener: player.addListener.bind(player),
    remove() {
      const error = completeFilePlayback(
        undefined,
        () => player.clearLockScreenControls(),
        () => player.remove(),
      );
      if (error) throw error;
    },
  };
}
