import { describe, expect, it, vi } from "vitest";
import { startNativeCapture } from "./native-capture";
function fixture() {
  return {
    startWakeWordDictation: vi.fn(() => true),
    startDictation: vi.fn(() => true),
    toggleRecording: vi.fn((_enabled: boolean) => true),
  };
}
describe("native one-shot capture ownership", () => {
  it("claims an existing wake capture without opening manual or conversation capture", () => {
    const native = fixture();
    expect(startNativeCapture(native, "dictation", true)).toBe(true);
    expect(native.startWakeWordDictation).toHaveBeenCalledOnce();
    expect(native.startDictation).not.toHaveBeenCalled();
    expect(native.toggleRecording).not.toHaveBeenCalled();
  });
  it("refuses expired/backgrounded handoffs without falling through to a new microphone capture", () => {
    const native = fixture();
    native.startWakeWordDictation.mockReturnValue(false);
    expect(() => startNativeCapture(native, "dictation", true)).toThrow("expired");
    expect(native.startDictation).not.toHaveBeenCalled();
    expect(native.toggleRecording).not.toHaveBeenCalled();
  });
  it("keeps manual dictation on its existing native path", () => {
    const native = fixture();
    expect(startNativeCapture(native, "dictation", false)).toBe(true);
    expect(native.startDictation).toHaveBeenCalledOnce();
    expect(native.startWakeWordDictation).not.toHaveBeenCalled();
    expect(native.toggleRecording).not.toHaveBeenCalled();
  });
  it("keeps ordinary voice capture on its existing native path", () => {
    const native = fixture();
    expect(startNativeCapture(native, undefined, false)).toBe(true);
    expect(native.toggleRecording).toHaveBeenCalledExactlyOnceWith(true);
    expect(native.startWakeWordDictation).not.toHaveBeenCalled();
    expect(native.startDictation).not.toHaveBeenCalled();
  });
});
