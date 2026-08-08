import type { WakeWordDetector } from "./wake-word-listening";
import { getWakeWordCapability } from "./wake-word-capability";
import { getIsElectron } from "@/constants/platform";
import { createElectronWakeWordDetector } from "./wake-word-detector.electron";
import { ensureWakeWordMicrophonePermission } from "./wake-word-permission";

/**
 * Native keyword spotting is an installation capability, not a JavaScript
 * speech recognizer. The native model/module will replace this factory when it
 * is packaged. Keeping the failure explicit prevents an accidental browser or
 * daemon-streaming fallback from weakening the privacy contract.
 */
export function createWakeWordDetector(): WakeWordDetector {
  if (getIsElectron()) {
    return createElectronWakeWordDetector();
  }

  const capability = getWakeWordCapability();
  if (capability.available) {
    const native = require("@otto-code/expo-two-way-audio") as {
      startWakeWordDetection: (phrase: string, sensitivity: number) => Promise<void>;
      stopWakeWordDetection: () => Promise<void>;
      getMicrophonePermissionsAsync: () => Promise<{ granted: boolean }>;
      requestMicrophonePermissionsAsync: () => Promise<{ granted: boolean }>;
      addExpoTwoWayAudioEventListener: (
        event: "onWakeWordDetected",
        listener: (event: { data: { phrase: string } }) => void,
      ) => { remove: () => void };
    };
    return {
      start: async (settings) => {
        await ensureWakeWordMicrophonePermission(native);
        await native.startWakeWordDetection(settings.phrase, settings.sensitivity);
      },
      stop: () => native.stopWakeWordDetection(),
      onDetected: (listener) => {
        const subscription = native.addExpoTwoWayAudioEventListener("onWakeWordDetected", () =>
          listener(),
        );
        return () => subscription.remove();
      },
    };
  }

  const reason = capability.reason ?? "This build does not include a native wake-word model.";
  return {
    async start() {
      throw new Error(reason);
    },
    async stop() {},
    onDetected() {
      return () => undefined;
    },
  };
}
