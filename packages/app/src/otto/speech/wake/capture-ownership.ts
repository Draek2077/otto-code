import { createCapturePriority } from "../capture-priority";
import type { AudioEngine } from "@/audio/audio-engine-types";
interface ListenerOwner {
  pause(): Promise<void>;
  resume(): Promise<void>;
}
const listeners = new Set<ListenerOwner>();
let captures = 0;
export const hasActiveCapture = () => captures > 0;
export function registerWakeCaptureOwner(owner: ListenerOwner) {
  listeners.add(owner);
  if (captures) void owner.pause().catch(() => {});
  return () => {
    listeners.delete(owner);
  };
}
function claimCapture() {
  captures++;
  const ready = Promise.all([...listeners].map((owner) => owner.pause())).then(() => undefined);
  let released = false;
  return {
    ready,
    release() {
      if (released) return;
      released = true;
      captures--;
      if (!captures) for (const owner of listeners) void owner.resume().catch(() => {});
    },
  };
}
export function createWakeCaptureGuard<TArgs extends unknown[] = []>(
  source: () => { start(...args: TArgs): Promise<void>; stop(): Promise<void> },
) {
  let lease: ReturnType<typeof claimCapture> | null = null;
  return createCapturePriority<TArgs>(
    () => ({
      async start(...args: TArgs) {
        await lease?.ready;
        await source().start(...args);
      },
      stop: () => source().stop(),
    }),
    () => {
      const current = claimCapture();
      lease = current;
      return () => {
        current.release();
        if (lease === current) lease = null;
      };
    },
  );
}
export function wakeAwareAudioEngine(engine: AudioEngine): AudioEngine {
  const capture = createWakeCaptureGuard(() => ({
    start: (...args: Parameters<AudioEngine["startCapture"]>) => engine.startCapture(...args),
    stop: () => engine.stopCapture(),
  }));
  return {
    ...engine,
    startCapture: capture.start,
    stopCapture: capture.stop,
    async destroy() {
      capture.close();
      await capture.stop();
      await engine.destroy();
    },
  };
}
