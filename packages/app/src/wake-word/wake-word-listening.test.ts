import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WAKE_WORD_SETTINGS,
  WakeWordListeningController,
  normalizeWakeWordSettings,
  type WakeWordDetector,
} from "./wake-word-listening";

function detectorFake() {
  let listener: ((preRollPcm?: string, speechAlreadyDetected?: boolean) => void) | null = null;
  const detector: WakeWordDetector = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    onDetected: vi.fn((next) => {
      listener = next;
      return () => {
        listener = null;
      };
    }),
  };
  return {
    detector,
    detect: (preRollPcm?: string, speechAlreadyDetected?: boolean) =>
      listener?.(preRollPcm, speechAlreadyDetected),
  };
}

describe("wake-word listening", () => {
  it("is disabled by default and normalizes unsafe settings", () => {
    expect(DEFAULT_WAKE_WORD_SETTINGS.enabled).toBe(false);
    expect(
      normalizeWakeWordSettings({ enabled: true, sensitivity: 4, silenceTimeoutMs: 1 }),
    ).toEqual({
      ...DEFAULT_WAKE_WORD_SETTINGS,
      enabled: true,
      sensitivity: 1,
      silenceTimeoutMs: 300,
    });
  });

  it("does not start a detector until explicitly enabled", async () => {
    const { detector } = detectorFake();
    const actions = { startDictation: vi.fn(), confirmDictation: vi.fn() };
    const controller = new WakeWordListeningController(detector, actions);
    expect(controller.getState()).toBe("disabled");
    expect(detector.start).not.toHaveBeenCalled();
    await controller.enable({ ...DEFAULT_WAKE_WORD_SETTINGS, enabled: true });
    expect(detector.start).toHaveBeenCalledOnce();
    expect(controller.getState()).toBe("listening");
  });

  it("starts existing dictation after a local detection and ignores duplicates", async () => {
    const { detector, detect } = detectorFake();
    const states: string[] = [];
    const actions = {
      startDictation: vi.fn(async () => undefined),
      cancelDictation: vi.fn(),
      confirmDictation: vi.fn(),
    };
    const controller = new WakeWordListeningController(detector, actions, (state) =>
      states.push(state),
    );
    await controller.enable({ ...DEFAULT_WAKE_WORD_SETTINGS, enabled: true });
    detect("pre-roll-pcm", true);
    detect();
    await Promise.resolve();
    expect(actions.startDictation).toHaveBeenCalledOnce();
    expect(actions.startDictation).toHaveBeenCalledWith(false, "pre-roll-pcm", true);
    expect(detector.stop).toHaveBeenCalledOnce();
    expect(states).toEqual(["listening", "recording"]);
  });

  it("surfaces detector failures and can recover", async () => {
    const { detector } = detectorFake();
    detector.start = vi.fn().mockRejectedValue(new Error("permission denied"));
    const states: string[] = [];
    const controller = new WakeWordListeningController(
      detector,
      { startDictation: vi.fn(), confirmDictation: vi.fn() },
      (state) => states.push(state),
    );
    await expect(
      controller.enable({ ...DEFAULT_WAKE_WORD_SETTINGS, enabled: true }),
    ).rejects.toThrow("permission denied");
    expect(controller.getState()).toBe("error");
    expect(states).toEqual(["listening", "error"]);
  });
});
