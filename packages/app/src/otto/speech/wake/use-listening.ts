import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { getIsElectron } from "@/constants/platform";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useSettings } from "@/hooks/use-settings";
import type { UseDictationResult } from "@/hooks/use-dictation.shared";
import { createWakeWordDetector } from "./detector";
import { WakeWordListeningController } from "./controller";
import { hasActiveCapture, registerWakeCaptureOwner } from "./capture-ownership";
import { ownWakeStatus } from "./status";
import { createWakeDictationSession } from "./dictation-session";
import { useWakeCapability } from "./use-capability";

interface ListeningInput {
  active: boolean;
  voiceInput: boolean;
  canStart: boolean;
  disabled?: boolean;
  liveVoice?: boolean;
  serverId?: string;
  agentId?: string;
  dictation: Pick<
    UseDictationResult,
    | "startDictation"
    | "cancelDictation"
    | "confirmDictation"
    | "isRecordingActive"
    | "isRecording"
    | "isProcessing"
    | "status"
  >;
  setAutoSend(value: boolean): void;
}
export function useWakeListening(input: ListeningInput) {
  const settings = useSettings((value) => value);
  const capability = useWakeCapability();
  const retained = useRetainedPanelActive();
  const latest = useRef(input);
  latest.current = input;
  const controller = useRef<WakeWordListeningController | null>(null);
  const [command] = useState(() =>
    createWakeDictationSession({
      async confirm(autoSend) {
        latest.current.setAutoSend(autoSend);
        await latest.current.dictation.confirmDictation();
      },
      cancel: () => latest.current.dictation.cancelDictation(),
    }),
  );
  const [foreground, setForeground] = useState(
    () => getIsElectron() || AppState.currentState === "active",
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(getIsElectron() || state === "active"),
    );
    return () => subscription.remove();
  }, []);
  const eligible =
    retained &&
    input.active &&
    input.voiceInput &&
    input.canStart &&
    !input.disabled &&
    !input.liveVoice;
  const enabled =
    eligible &&
    foreground &&
    capability.available &&
    settings.wakeWordEnabled &&
    !settings.wakeWordListeningPaused;
  const targetKey = `${input.serverId ?? ""}:${input.agentId ?? "draft"}`;
  const {
    wakeWordPhrase: phrase,
    wakeWordSensitivity: sensitivity,
    wakeWordSilenceTimeoutMs: silenceTimeoutMs,
    wakeWordAutoSend: autoSend,
  } = settings;
  useEffect(() => {
    if (!enabled) return;
    const status = ownWakeStatus();
    const owner = new WakeWordListeningController(
      createWakeWordDetector(),
      {
        async start(capturedAutoSend, pcm, speechAlreadyDetected) {
          const current = latest.current;
          if (
            `${current.serverId ?? ""}:${current.agentId ?? "draft"}` !== targetKey ||
            !current.active
          )
            return false;
          command.begin({ autoSend: capturedAutoSend, silenceTimeoutMs, speechAlreadyDetected });
          if (pcm) command.accept(pcm);
          await latest.current.dictation.startDictation({ initialPcm: pcm });
          if (!latest.current.dictation.isRecordingActive()) {
            command.stop();
            return false;
          }
          command.started();
          return true;
        },
        async cancel() {
          command.stop();
          await latest.current.dictation.cancelDictation();
        },
      },
      status.publish,
    );
    controller.current = owner;
    if (hasActiveCapture()) void owner.pause();
    const release = registerWakeCaptureOwner(owner);
    void owner.enable({ enabled: true, phrase, sensitivity, silenceTimeoutMs, autoSend });
    return () => {
      if (controller.current === owner) controller.current = null;
      release();
      command.stop();
      status.release();
      void owner.close();
    };
  }, [enabled, targetKey, phrase, sensitivity, silenceTimeoutMs, autoSend, command]);
  useEffect(() => {
    if (
      !input.dictation.isRecording &&
      !input.dictation.isProcessing &&
      input.dictation.status !== "recording"
    )
      command.stop();
    void controller.current?.notifyDictation(
      input.dictation.isRecording,
      input.dictation.isProcessing,
    );
  }, [input.dictation.isRecording, input.dictation.isProcessing, input.dictation.status, command]);
  return command.accept;
}
