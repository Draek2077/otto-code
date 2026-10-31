import { Buffer } from "buffer";
import { hasPcm16VoiceActivity } from "./wake-word-audio";
export interface WakeDictationStart {
  initialPcm?: string;
}
/** One foreground command, with no automatic sending until its captured policy
 * is consumed by confirmation. Silent activation cancels instead of submitting.
 */
export function createWakeDictationSession(actions: {
  confirm(autoSend: boolean): Promise<void>;
  cancel(): Promise<void>;
}) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active = false;
  let ready = false;
  let heardSpeech = false;
  let autoSend = false;
  let silenceMs = 1100;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const finish = async () => {
    if (!active) return;
    active = false;
    clear();
    if (heardSpeech) await actions.confirm(autoSend);
    else await actions.cancel();
  };
  const arm = () => {
    clear();
    if (active && ready)
      timer = setTimeout(
        () => {
          void finish().catch(() => {});
        },
        heardSpeech ? silenceMs : 8000,
      );
  };
  return {
    begin(options: {
      autoSend: boolean;
      silenceTimeoutMs: number;
      speechAlreadyDetected?: boolean;
    }) {
      clear();
      active = true;
      ready = false;
      heardSpeech = options.speechAlreadyDetected === true;
      autoSend = options.autoSend;
      silenceMs = options.silenceTimeoutMs;
    },
    started() {
      ready = true;
      arm();
    },
    accept(pcm: string) {
      if (!active) return;
      if (hasPcm16VoiceActivity(Buffer.from(pcm, "base64"))) {
        heardSpeech = true;
        arm();
      }
    },
    stop() {
      active = false;
      ready = false;
      clear();
    },
  };
}
