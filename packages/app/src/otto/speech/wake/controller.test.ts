import { describe, expect, it, vi } from "vitest";
import {
  WakeWordListeningController,
  type WakeWordSettings,
  type WakeWordState,
} from "./controller";
const settings: WakeWordSettings = {
  enabled: true,
  phrase: "Hey Otto",
  sensitivity: 0.7,
  silenceTimeoutMs: 1100,
  autoSend: false,
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function flush() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
function fixture() {
  let detected: ((pcm?: string, speech?: boolean) => void) | null = null;
  let failed: ((error: Error) => void) | null = null;
  const states: { state: WakeWordState; error?: string }[] = [];
  const detector = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async (_discard?: boolean) => {}),
    onDetected(listener: NonNullable<typeof detected>) {
      detected = listener;
      return () => {
        detected = null;
      };
    },
    onError(listener: NonNullable<typeof failed>) {
      failed = listener;
      return () => {
        failed = null;
      };
    },
  };
  const dictation = {
    start: vi.fn(async (_autoSend: boolean, _pcm?: string, _speech?: boolean) => true),
    cancel: vi.fn(async () => {}),
  };
  const controller = new WakeWordListeningController(detector, dictation, (state, error) =>
    states.push({ state, error }),
  );
  return {
    controller,
    detector,
    dictation,
    states,
    detect: (pcm?: string, speech?: boolean) => detected?.(pcm, speech),
    error: () => failed?.(new Error("Capture interrupted")),
  };
}
describe("local wake listening lifecycle", () => {
  it("does not start or request capture while opt-in is off", async () => {
    const f = fixture();
    await f.controller.enable({ ...settings, enabled: false });
    expect(f.detector.start).not.toHaveBeenCalled();
    expect(f.dictation.start).not.toHaveBeenCalled();
    await f.controller.close();
  });
  it("hands off once, captures send policy, and resumes only after transcription finishes", async () => {
    const f = fixture();
    await f.controller.enable(settings);
    f.detect("command-only", true);
    f.detect();
    await flush();
    expect(f.detector.stop).toHaveBeenCalledWith(false);
    expect(f.dictation.start).toHaveBeenCalledExactlyOnceWith(false, "command-only", true);
    await f.controller.notifyDictation(true, false);
    await f.controller.notifyDictation(false, true);
    expect(f.states.at(-1)?.state).toBe("processing");
    expect(f.detector.start).toHaveBeenCalledTimes(1);
    await f.controller.notifyDictation(false, false);
    expect(f.detector.start).toHaveBeenCalledTimes(2);
    await f.controller.close();
  });
  it("pauses before manual capture and waits for its busy state to clear before resuming", async () => {
    const f = fixture();
    await f.controller.enable(settings);
    await f.controller.pause();
    await f.controller.notifyDictation(true, false);
    await f.controller.resume();
    expect(f.detector.start).toHaveBeenCalledTimes(1);
    await f.controller.notifyDictation(false, false);
    expect(f.detector.start).toHaveBeenCalledTimes(2);
    await f.controller.close();
    expect(f.dictation.cancel).not.toHaveBeenCalled();
  });
  it("revokes a detection awaiting teardown before it can start a command", async () => {
    const f = fixture();
    await f.controller.enable(settings);
    const stop = deferred();
    f.detector.stop.mockImplementationOnce(() => stop.promise);
    f.detect();
    await flush();
    const close = f.controller.close();
    stop.resolve();
    await close;
    await flush();
    expect(f.dictation.start).not.toHaveBeenCalled();
    expect(f.states.at(-1)?.state).toBe("disabled");
  });
  it("stops late permission/start success after closing, without relistening", async () => {
    const f = fixture();
    const start = deferred();
    f.detector.start.mockImplementationOnce(() => start.promise);
    const enabling = f.controller.enable(settings);
    await flush();
    const close = f.controller.close();
    start.resolve();
    await enabling;
    await close;
    expect(f.detector.stop).toHaveBeenCalled();
    expect(f.states.at(-1)?.state).toBe("disabled");
    f.detect();
    expect(f.dictation.start).not.toHaveBeenCalled();
  });
  it("exposes interruption errors and requires an explicit resume to retry", async () => {
    const f = fixture();
    await f.controller.enable(settings);
    f.error();
    await flush();
    expect(f.states.at(-1)).toMatchObject({ state: "error", error: "Capture interrupted" });
    await f.controller.notifyDictation(false, false);
    expect(f.detector.start).toHaveBeenCalledTimes(1);
    await f.controller.pause();
    await f.controller.resume();
    expect(f.detector.start).toHaveBeenCalledTimes(2);
    await f.controller.close();
  });
  it("cancels owned pending dictation after close without adopting its late success", async () => {
    const f = fixture();
    const command = deferred();
    f.dictation.start.mockImplementationOnce(async () => {
      await command.promise;
      return true;
    });
    await f.controller.enable({ ...settings, autoSend: true });
    f.detect();
    await flush();
    const close = f.controller.close();
    command.resolve();
    await close;
    await flush();
    expect(f.dictation.start).toHaveBeenCalledWith(true, undefined, undefined);
    expect(f.dictation.cancel).toHaveBeenCalled();
    expect(f.states.at(-1)?.state).toBe("disabled");
  });
});
