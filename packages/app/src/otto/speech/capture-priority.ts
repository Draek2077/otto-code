interface CaptureSource<TArgs extends unknown[]> {
  start(...args: TArgs): Promise<void>;
  stop(): Promise<void>;
}

/** Output is silenced before asking for microphone permission. Keep priority
 * through a pending start and actual stop, including late unmount cleanup.
 * This wrapper never constructs, initializes or polls a recording engine.
 */
export function createCapturePriority<TArgs extends unknown[] = []>(
  source: () => CaptureSource<TArgs>,
  acquire: () => () => void,
) {
  let release: (() => void) | null = null;
  let starting: Promise<void> | null = null;
  let stopping: Promise<void> | null = null;
  let closed = false;
  const relinquish = () => {
    release?.();
    release = null;
  };
  const stop = () => {
    if (stopping) return stopping;
    const pending = starting;
    stopping = (async () => {
      try {
        await pending?.catch(() => {});
        await source().stop();
      } finally {
        relinquish();
      }
    })().finally(() => {
      stopping = null;
    });
    return stopping;
  };
  return {
    async start(...args: TArgs) {
      if (closed) throw new Error("Dictation source is closed.");
      if (stopping) await stopping;
      if (closed) throw new Error("Dictation source is closed.");
      release ??= acquire();
      const pending = starting ?? Promise.resolve().then(() => source().start(...args));
      starting = pending;
      try {
        await pending;
      } catch (error) {
        relinquish();
        throw error;
      } finally {
        if (starting === pending) starting = null;
      }
    },
    stop,
    close() {
      closed = true;
      void stop().catch(() => {});
    },
  };
}
