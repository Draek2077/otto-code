import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAudioEngine: vi.fn(),
  wakeWord: { start: vi.fn(), stop: vi.fn(), audio: vi.fn() },
  events: { on: vi.fn() },
  listeners: new Set<() => void>(),
}));

vi.mock("@/desktop/host", () => ({
  getDesktopHost: () => ({ wakeWord: mocks.wakeWord, events: mocks.events }),
}));
vi.mock("@/voice/audio-engine", () => ({ createAudioEngine: mocks.createAudioEngine }));

import { createElectronWakeWordDetector } from "./wake-word-detector.electron";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function engineFake() {
  return {
    startCapture: vi.fn(async (): Promise<void> => undefined),
    stopCapture: vi.fn(async (): Promise<void> => undefined),
    destroy: vi.fn(async (): Promise<void> => undefined),
  };
}

beforeEach(() => {
  mocks.wakeWord.start.mockResolvedValue(undefined);
  mocks.wakeWord.stop.mockResolvedValue(undefined);
  mocks.wakeWord.audio.mockResolvedValue(undefined);
  mocks.events.on.mockImplementation((_event, listener: () => void) => {
    mocks.listeners.add(listener);
    return () => mocks.listeners.delete(listener);
  });
});
afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
  mocks.listeners.clear();
});

describe("Electron wake-word microphone ownership", () => {
  it("finishes the old listener teardown before starting its replacement", async () => {
    const stopping = deferred();
    const firstEngine = engineFake();
    const secondEngine = engineFake();
    firstEngine.stopCapture.mockImplementationOnce(() => stopping.promise);
    mocks.createAudioEngine.mockReturnValueOnce(firstEngine).mockReturnValueOnce(secondEngine);
    let nativeListening = false;
    mocks.wakeWord.start.mockImplementation(async () => {
      nativeListening = true;
    });
    mocks.wakeWord.stop.mockImplementation(async () => {
      nativeListening = false;
    });
    const first = createElectronWakeWordDetector();
    const second = createElectronWakeWordDetector();
    await first.start({ phrase: "Hey Otto", sensitivity: 0.7 });
    const stopped = first.stop();
    const started = second.start({ phrase: "Hey Otto", sensitivity: 0.7 });
    stopping.resolve();
    await Promise.all([stopped, started]);
    try {
      expect(nativeListening).toBe(true);
      expect(secondEngine.startCapture).toHaveBeenCalledOnce();
    } finally {
      await second.stop();
    }
  });

  it("does not close a microphone graph while its startup is still pending", async () => {
    const capturing = deferred();
    const engine = engineFake();
    engine.startCapture.mockImplementationOnce(() => capturing.promise);
    mocks.createAudioEngine.mockReturnValue(engine);
    const detector = createElectronWakeWordDetector();
    const started = detector.start({ phrase: "Hey Otto", sensitivity: 0.7 });
    await vi.waitFor(() => expect(engine.startCapture).toHaveBeenCalledOnce());
    const stopped = detector.stop();
    await Promise.resolve();
    const closedDuringStartup = engine.stopCapture.mock.calls.length > 0;
    capturing.resolve();
    await Promise.all([started, stopped]);
    expect(closedDuringStartup).toBe(false);
    expect(engine.destroy).toHaveBeenCalledOnce();
  });

  it("ignores late stop calls from a replaced listener", async () => {
    const firstEngine = engineFake();
    const secondEngine = engineFake();
    mocks.createAudioEngine.mockReturnValueOnce(firstEngine).mockReturnValueOnce(secondEngine);
    const first = createElectronWakeWordDetector();
    const second = createElectronWakeWordDetector();
    await first.start({ phrase: "Hey Otto", sensitivity: 0.7 });
    await second.start({ phrase: "Hey Otto", sensitivity: 0.7 });
    const nativeStops = mocks.wakeWord.stop.mock.calls.length;
    await first.stop();
    try {
      expect(firstEngine.destroy).toHaveBeenCalledOnce();
      expect(secondEngine.stopCapture).not.toHaveBeenCalled();
      expect(mocks.wakeWord.stop).toHaveBeenCalledTimes(nativeStops);
    } finally {
      await second.stop();
    }
  });

  it("releases failed capture startup and allows the next listener to start", async () => {
    const firstEngine = engineFake();
    const secondEngine = engineFake();
    firstEngine.startCapture.mockRejectedValueOnce(new Error("capture failed"));
    mocks.createAudioEngine.mockReturnValueOnce(firstEngine).mockReturnValueOnce(secondEngine);
    const first = createElectronWakeWordDetector();
    const second = createElectronWakeWordDetector();
    await expect(first.start({ phrase: "Hey Otto", sensitivity: 0.7 })).rejects.toThrow(
      "capture failed",
    );
    await second.start({ phrase: "Hey Otto", sensitivity: 0.7 });
    const nativeStops = mocks.wakeWord.stop.mock.calls.length;
    await first.stop();
    try {
      expect(firstEngine.destroy).toHaveBeenCalledOnce();
      expect(secondEngine.startCapture).toHaveBeenCalledOnce();
      expect(mocks.wakeWord.stop).toHaveBeenCalledTimes(nativeStops);
    } finally {
      await second.stop();
    }
  });

  it("routes audio and detection only through the replacement listener", async () => {
    vi.useFakeTimers();
    mocks.createAudioEngine.mockReturnValueOnce(engineFake()).mockReturnValueOnce(engineFake());
    const first = createElectronWakeWordDetector();
    const second = createElectronWakeWordDetector();
    const firstDetected = vi.fn();
    const secondDetected = vi.fn();
    first.onDetected(firstDetected);
    await first.start({ phrase: "Hey Otto", sensitivity: 0.7 });
    second.onDetected(secondDetected);
    await second.start({ phrase: "Hey Otto", sensitivity: 0.7 });
    try {
      const firstCapture = mocks.createAudioEngine.mock.calls[0][0].onCaptureData;
      const secondCapture = mocks.createAudioEngine.mock.calls[1][0].onCaptureData;
      const pcm = new Uint8Array([0, 32, 0, 32]);
      firstCapture(pcm);
      expect(mocks.wakeWord.audio).not.toHaveBeenCalled();
      for (const listener of mocks.listeners) listener();
      secondCapture(pcm);
      await vi.advanceTimersByTimeAsync(350);
      expect(firstDetected).not.toHaveBeenCalled();
      expect(secondDetected).toHaveBeenCalledOnce();
      expect(secondDetected.mock.calls[0][0]).toBe(btoa(String.fromCharCode(...pcm)));
      expect(mocks.wakeWord.audio).toHaveBeenCalledOnce();
    } finally {
      await second.stop();
    }
  });
});
