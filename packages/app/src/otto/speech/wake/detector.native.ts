import * as native from "@getpaseo/expo-two-way-audio";
import { ensureWakeWordMicrophonePermission } from "./wake-word-permission";
import type { WakeWordCapability } from "./bridge";
import type { WakeWordDetector } from "./controller";
export async function readWakeCapability(): Promise<WakeWordCapability> {
  return native.getWakeWordCapabilities();
}
export function createWakeWordDetector(): WakeWordDetector {
  let detecting = false;
  return {
    async start(settings) {
      await ensureWakeWordMicrophonePermission(native);
      detecting = true;
      try {
        await native.startWakeWordDetection(settings.phrase, settings.sensitivity);
      } catch (reason) {
        detecting = false;
        throw reason;
      }
    },
    async stop(discard = true) {
      detecting = false;
      await native.stopWakeWordDetection(discard);
    },
    onDetected(listener) {
      const subscription = native.addExpoTwoWayAudioEventListener("onWakeWordDetected", () =>
        listener(),
      );
      return () => subscription.remove();
    },
    onError(listener) {
      const subscription = native.addExpoTwoWayAudioEventListener(
        "onAudioInterruption",
        (event) => {
          if (detecting && (event.data === "blocked" || event.data === "capture_paused"))
            listener(
              new Error(
                "Hey Otto microphone capture was interrupted. Pause and resume listening to retry.",
              ),
            );
        },
      );
      return () => subscription.remove();
    },
  };
}
