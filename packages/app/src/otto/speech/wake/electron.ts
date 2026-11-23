import { getDesktopHost } from "@/desktop/host";
import { createAudioEngine } from "@/audio";
import type { AudioEngine } from "@/audio/audio-engine-types";
import type { WakeWordDetector } from "./controller";
import { hasPcm16VoiceActivity } from "./wake-word-audio";

const PRE_ROLL_MS = 800;
const POST_DETECTION_MS = 350;
const PRE_ROLL_BYTES = (16_000 * 2 * PRE_ROLL_MS) / 1000;

// Desktop has one native detector per renderer, even though focused composers
// create separate handles. React effect cleanup cannot await the old handle's
// teardown: its late IPC stop would otherwise delete the replacement session.
// Keep capture startup and teardown in the same renderer-wide sequence, including
// pending getUserMedia/worklet setup so teardown cannot close a graph mid-start.
let detectorOperation: Promise<void> = Promise.resolve();
let activeDetectorStop: (() => Promise<void>) | null = null;

function sequenceDetectorOperation(operation: () => Promise<void>): Promise<void> {
  const next = detectorOperation.then(operation);
  // Report this failure to its caller without poisoning subsequent recovery.
  detectorOperation = next.catch(() => undefined);
  return next;
}

function encodePcm(pcm: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < pcm.length; index += 1) {
    binary += String.fromCharCode(pcm[index]);
  }
  return btoa(binary);
}

export function createElectronWakeWordDetector(): WakeWordDetector {
  const errors = new Set<(error: Error) => void>();
  const report = (error: unknown) => {
    const normalized =
      error instanceof Error ? error : new Error("Local wake-word capture failed.");
    for (const listener of errors) listener(normalized);
  };
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

  const stopSession = async () => {
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
    // A delayed cleanup from an unfocused composer only owns its own capture
    // graph. It must never stop the native session claimed by the new composer.
    if (activeDetectorStop === stopSession) {
      activeDetectorStop = null;
      await getDesktopHost()
        ?.wakeWord?.stop?.()
        .catch(() => undefined);
    }
  };

  return {
    start(settings) {
      return sequenceDetectorOperation(async () => {
        if (activeDetectorStop) await activeDetectorStop();
        preRollChunks = [];
        preRollBytes = 0;
        const nextEngine = createAudioEngine({
          onCaptureData: (pcm) => {
            if (activeDetectorStop !== stopSession) return;
            rememberPcm(pcm);
            const audio = getDesktopHost()?.wakeWord?.audio;
            if (typeof audio !== "function") {
              report(new Error("The desktop's local wake-word audio bridge is unavailable."));
              return;
            }
            void audio(encodePcm(pcm)).catch(report);
          },
          onVolumeLevel: () => undefined,
          onError: report,
        });
        engine = nextEngine;
        const wakeWord = getDesktopHost()?.wakeWord;
        if (typeof wakeWord?.start !== "function") {
          throw new Error("Desktop wake-word bridge is unavailable.");
        }
        try {
          await wakeWord.start({ phrase: settings.phrase, sensitivity: settings.sensitivity });
          activeDetectorStop = stopSession;
          await nextEngine.startCapture();
        } catch (error) {
          await stopSession();
          throw error;
        }
      });
    },

    stop() {
      return sequenceDetectorOperation(stopSession);
    },
    onError(listener) {
      errors.add(listener);
      return () => {
        errors.delete(listener);
      };
    },

    onDetected(listener) {
      const events = getDesktopHost()?.events;
      if (!events?.on) return () => undefined;
      let active = true;
      void Promise.resolve(
        events.on("wake-word-detected", () => {
          if (!active || activeDetectorStop !== stopSession || detectionTimer) return;
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
