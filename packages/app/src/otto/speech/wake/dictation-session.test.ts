import { Buffer } from "buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWakeDictationSession } from "./dictation-session";
afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers();
  const actions = { confirm: vi.fn(async (_send: boolean) => {}), cancel: vi.fn(async () => {}) };
  return { actions, command: createWakeDictationSession(actions) };
}
describe("one detected command", () => {
  it("does not expire a pending capture start and confirms detected speech once after silence", async () => {
    const f = fixture();
    f.command.begin({ autoSend: false, silenceTimeoutMs: 1100, speechAlreadyDetected: true });
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.actions.confirm).not.toHaveBeenCalled();
    f.command.started();
    await vi.advanceTimersByTimeAsync(1100);
    expect(f.actions.confirm).toHaveBeenCalledExactlyOnceWith(false);
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.actions.confirm).toHaveBeenCalledTimes(1);
  });
  it("cancels a silent wake without sending an empty command", async () => {
    const f = fixture();
    f.command.begin({ autoSend: true, silenceTimeoutMs: 1100 });
    f.command.started();
    f.command.accept(Buffer.alloc(1024).toString("base64"));
    await vi.advanceTimersByTimeAsync(8000);
    expect(f.actions.cancel).toHaveBeenCalledOnce();
    expect(f.actions.confirm).not.toHaveBeenCalled();
  });
  it("rearms silence only for speech and retains the detected send policy", async () => {
    const f = fixture();
    f.command.begin({ autoSend: true, silenceTimeoutMs: 1100 });
    f.command.started();
    const voice = Buffer.alloc(1024);
    for (let index = 0; index < voice.length; index += 2) voice.writeInt16LE(5000, index);
    f.command.accept(voice.toString("base64"));
    await vi.advanceTimersByTimeAsync(1000);
    f.command.accept(voice.toString("base64"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.actions.confirm).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.actions.confirm).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("releases timers on manual stop, hide or cancellation", async () => {
    const f = fixture();
    f.command.begin({ autoSend: true, silenceTimeoutMs: 1100, speechAlreadyDetected: true });
    f.command.started();
    f.command.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.actions.confirm).not.toHaveBeenCalled();
    expect(f.actions.cancel).not.toHaveBeenCalled();
  });
});
