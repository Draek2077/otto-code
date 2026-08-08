import { getDesktopHost } from "@/desktop/host";
import { createAudioEngine } from "@/voice/audio-engine";
import type { AudioEngine } from "@/voice/audio-engine-types";
import type { WakeWordDetector } from "./wake-word-listening";
import { hasPcm16VoiceActivity } from "./wake-word-audio";

const PRE_ROLL_MS = 800;
const POST_DETECTION_MS = 350;
const PRE_ROLL_BYTES = (16_000 * 2 * PRE_ROLL_MS) / 1000;

function encodePcm(pcm: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < pcm.length; index += 1) {
    binary += String.fromCharCode(pcm[index]);
  }
  return btoa(binary);
}

export function createElectronWakeWordDetector(): WakeWordDetector {
  let engine: AudioEngine | null = null;
  let removeEventListener: (() => void) | null = null;
  let detectionTimer: ReturnType<typeof setTimeout> | null = null;
  let preRollChunks: Uint8Array[] = [];
  let preRollBytes = 0;

  const rememberPcm = (pcm: Uint8Array) => {
    preRollChunks.push(pcm.slice());
    preRollBytes += pcm.byteLength;
    while (preRollBytes > PRE_ROLL_BYTES && preRollChunks.length > 1) {
      const removed = preRollChunks.shift();
      preRollBytes -= removed?.byteLength ?? 0;
    }
  };

  const getPreRollPcm = (): Uint8Array => {
    const output = new Uint8Array(Math.min(preRollBytes, PRE_ROLL_BYTES));
    let offset = 0;
    for (const chunk of preRollChunks) {
      const remaining = output.length - offset;
      if (remaining <= 0) break;
      const source = chunk.subarray(Math.max(0, chunk.length - remaining));
      output.set(source, offset);
      offset += source.length;
    }
    return output;
  };

  return {
    async start(settings) {
      preRollChunks = [];
      preRollBytes = 0;
      const nextEngine = createAudioEngine({
        onCaptureData: (pcm) => {
          rememberPcm(pcm);
          const audio = getDesktopHost()?.wakeWord?.audio;
          if (typeof audio !== "function") {
            console.error("[WakeWord][Electron] local audio bridge is unavailable");
            return;
          }
          void audio(encodePcm(pcm)).catch((error) => {
            console.error("[WakeWord][Electron] local audio handoff failed", error);
          });
        },
        onVolumeLevel: () => undefined,
        onError: (error) => {
          console.warn("[WakeWord][Electron] local capture failed", error);
        },
      });
      engine = nextEngine;
      const wakeWord = getDesktopHost()?.wakeWord;
      if (typeof wakeWord?.start !== "function") {
        throw new Error("Desktop wake-word bridge is unavailable.");
      }
      await wakeWord.start({ phrase: settings.phrase, sensitivity: settings.sensitivity });
      try {
        await nextEngine.startCapture();
      } catch (error) {
        await wakeWord.stop?.().catch(() => undefined);
        engine = null;
        throw error;
      }
    },

    async stop() {
      if (detectionTimer) {
        clearTimeout(detectionTimer);
        detectionTimer = null;
      }
      removeEventListener?.();
      removeEventListener = null;
      await engine?.stopCapture().catch(() => undefined);
      await engine?.destroy().catch(() => undefined);
      engine = null;
      preRollChunks = [];
      preRollBytes = 0;
      await getDesktopHost()
        ?.wakeWord?.stop?.()
        .catch(() => undefined);
    },

    onDetected(listener) {
      const events = getDesktopHost()?.events;
      if (!events?.on) return () => undefined;
      let active = true;
      void Promise.resolve(
        events.on("wake-word-detected", () => {
          if (!active || detectionTimer) return;
          // Discard the wake phrase and detector context. The handoff buffer
          // should contain only speech that begins after the wake event.
          preRollChunks = [];
          preRollBytes = 0;
          // Keep the local capture graph alive briefly so speech that starts
          // immediately after the wake phrase is included in the handoff.
          detectionTimer = setTimeout(() => {
            detectionTimer = null;
            if (active) {
              const preRollPcm = getPreRollPcm();
              listener(encodePcm(preRollPcm), hasPcm16VoiceActivity(preRollPcm));
            }
          }, POST_DETECTION_MS);
        }),
      ).then((remove) => {
        if (!active) {
          remove?.();
          return undefined;
        }
        removeEventListener = remove;
        return undefined;
      });
      return () => {
        active = false;
        if (detectionTimer) {
          clearTimeout(detectionTimer);
          detectionTimer = null;
        }
        removeEventListener?.();
        removeEventListener = null;
      };
    },
  };
}

// Metro resolves this file directly for Electron because of its platform
// suffix. Re-export the public factory from that resolved module so the hook
// receives the same API on every platform.
export function createWakeWordDetector(): WakeWordDetector {
  return createElectronWakeWordDetector();
}
