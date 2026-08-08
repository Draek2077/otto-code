import { AppState } from "react-native";
import { useEffect, useMemo, useRef, useState } from "react";

import { getIsElectron } from "@/constants/platform";
import { createWakeWordDetector } from "@/wake-word/wake-word-detector";
import { getWakeWordCapability } from "@/wake-word/wake-word-capability";
import {
  DEFAULT_WAKE_WORD_SETTINGS,
  WakeWordListeningController,
  normalizeWakeWordSettings,
  type WakeWordSettings,
  type WakeWordState,
} from "@/wake-word/wake-word-listening";

export function useWakeWordListening(input: {
  settings: Partial<WakeWordSettings> | null | undefined;
  startDictation: (
    autoSend?: boolean,
    preRollPcm?: string,
    speechAlreadyDetected?: boolean,
  ) => void | Promise<void>;
  cancelDictation?: () => void | Promise<void>;
  isRecording?: boolean;
  isProcessing?: boolean;
  onError?: (error: Error) => void;
}): WakeWordState {
  const [state, setState] = useState<WakeWordState>("disabled");
  const capability = getWakeWordCapability();
  const enabled = input.settings?.enabled;
  const phrase = input.settings?.phrase;
  const sensitivity = input.settings?.sensitivity;
  const silenceTimeoutMs = input.settings?.silenceTimeoutMs;
  const autoSend = input.settings?.autoSend;
  const settings = useMemo(
    () => normalizeWakeWordSettings({ enabled, phrase, sensitivity, silenceTimeoutMs, autoSend }),
    [autoSend, enabled, phrase, sensitivity, silenceTimeoutMs],
  );
  const controllerRef = useRef<WakeWordListeningController | null>(null);
  const onErrorRef = useRef(input.onError);
  const startDictationRef = useRef(input.startDictation);
  const cancelDictationRef = useRef(input.cancelDictation);
  onErrorRef.current = input.onError;
  startDictationRef.current = input.startDictation;
  cancelDictationRef.current = input.cancelDictation;

  useEffect(() => {
    if (!settings.enabled || !capability.available) {
      const controller = controllerRef.current;
      controllerRef.current = null;
      if (controller) void controller.disable().catch(() => undefined);
      setState("disabled");
      return;
    }

    const controller = new WakeWordListeningController(
      createWakeWordDetector(),
      {
        startDictation: (shouldAutoSend, preRollPcm, speechAlreadyDetected) =>
          startDictationRef.current(shouldAutoSend, preRollPcm, speechAlreadyDetected),
        cancelDictation: () => cancelDictationRef.current?.(),
        confirmDictation: async () => undefined,
      },
      (next, error) => {
        setState(next);
        if (error) onErrorRef.current?.(error);
      },
    );
    controllerRef.current = controller;
    void controller.enable(settings).catch(() => undefined);

    return () => {
      if (controllerRef.current === controller) controllerRef.current = null;
      void controller.disable().catch(() => undefined);
    };
  }, [capability.available, settings]);

  useEffect(() => {
    const keepListeningInBackground = getIsElectron();
    const subscription = AppState.addEventListener("change", (next) => {
      const controller = controllerRef.current;
      if (!controller || !settings.enabled || !capability.available) return;
      if (keepListeningInBackground) return;
      if (next !== "active") {
        void controller.disable().catch(() => undefined);
      } else {
        void controller
          .recover()
          .catch((error: unknown) =>
            onErrorRef.current?.(error instanceof Error ? error : new Error(String(error))),
          );
      }
    });
    return () => subscription.remove();
  }, [capability.available, settings.enabled]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller || !settings.enabled) return;
    void controller
      .notifyDictationState({
        isRecording: input.isRecording ?? false,
        isProcessing: input.isProcessing ?? false,
      })
      .catch((error: unknown) =>
        onErrorRef.current?.(error instanceof Error ? error : new Error(String(error))),
      );
  }, [input.isProcessing, input.isRecording, settings.enabled]);

  return state;
}

export { DEFAULT_WAKE_WORD_SETTINGS };
