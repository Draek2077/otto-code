import type { SpeechTtsSelection } from "@getpaseo/plugin/otto/speech";
export const IDLE_SPEECH_PLAYBACK = {
  key: null,
  hostId: null,
  itemId: null as string | null,
  phase: "idle" as const,
  error: "",
  errorKey: null as string | null,
};
export interface SpeechPlaybackRequest {
  hostId: string;
  key: string;
  itemId?: string;
  text: string;
  automatic?: boolean;
  cue?: boolean;
  selection?: SpeechTtsSelection;
}
export interface SpeechPlaybackPort {
  prepare(hostId: string, text: string): Promise<{ text: string; pauseAfterMs: number }[]>;
  available(hostId: string): boolean;
  occupied(): boolean;
  synthesize(input: {
    hostId: string;
    requestId: string;
    text: string;
    selection?: SpeechTtsSelection;
    pauseAfterMs?: number;
  }): Promise<{ base64: string; mimeType: string }>;
  cancel(hostId: string, requestId: string): Promise<unknown>;
  play(
    audio: { base64: string; mimeType: string },
    signal: AbortSignal,
    cue: boolean,
  ): Promise<void>;
}
interface SpeechJob {
  request: SpeechPlaybackRequest;
  controller: AbortController;
  requestId: string | null;
}

/** A single device queue. Navigation never owns this lifetime. Live conversation
 * takes precedence; history hydration is handled by the producer, not replayed.
 */
export function createSpeechPlayback(port: SpeechPlaybackPort) {
  let state = {
    key: null as string | null,
    hostId: null as string | null,
    itemId: null as string | null,
    phase: "idle" as "idle" | "generating" | "playing",
    error: "",
    errorKey: null as string | null,
  };
  const listeners = new Set<() => void>();
  const queue: SpeechPlaybackRequest[] = [];
  let current: SpeechJob | null = null;
  let serial = 0;
  let closed = false;
  let captures = 0;
  const occupied = () => captures > 0 || port.occupied();
  const publish = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const stop = () => {
    queue.length = 0;
    const job = current;
    if (job) {
      job.controller.abort();
      if (job.requestId) void port.cancel(job.request.hostId, job.requestId).catch(() => {});
    }
    current = null;
    publish({ key: null, hostId: null, itemId: null, phase: "idle" });
  };
  async function generateChunk(job: SpeechJob, segment: { text: string; pauseAfterMs: number }) {
    const requestId = `speech-${Date.now().toString(36)}-${++serial}`;
    job.requestId = requestId;
    try {
      const audio = await port.synthesize({
        hostId: job.request.hostId,
        requestId,
        text: segment.text,
        pauseAfterMs: segment.pauseAfterMs,
        selection: job.request.selection,
      });
      return { ok: true as const, audio };
    } catch (error) {
      return { ok: false as const, error };
    } finally {
      if (job.requestId === requestId) job.requestId = null;
    }
  }
  async function drain() {
    if (closed || current || !queue.length || occupied()) return;
    const request = queue.shift()!;
    if (!port.available(request.hostId)) {
      queue.length = 0;
      publish({ error: "Update or reconnect the host to use Speech.", errorKey: request.key });
      return;
    }
    const job = { request, controller: new AbortController(), requestId: null as string | null };
    current = job;
    publish({
      key: request.key,
      hostId: request.hostId,
      itemId: request.itemId ?? null,
      phase: "generating",
      error: "",
      errorKey: null,
    });
    try {
      const segments = await port.prepare(request.hostId, request.text);
      job.controller.signal.throwIfAborted();
      let pending = segments[0] ? generateChunk(job, segments[0]) : null;
      for (let index = 0; pending && index < segments.length; index++) {
        job.controller.signal.throwIfAborted();
        if (occupied()) break;
        publish({ phase: "generating" });
        const generated = await pending;
        if (!generated.ok) throw generated.error;
        job.controller.signal.throwIfAborted();
        if (occupied()) break;
        // Exactly one bounded read-ahead; its rejection is captured until it is
        // consumed, never an unhandled promise or a second playback channel.
        const next = segments[index + 1];
        pending = next ? generateChunk(job, next) : null;
        publish({ phase: "playing" });
        await port.play(generated.audio, job.controller.signal, request.cue === true);
      }
    } catch {
      if (!job.controller.signal.aborted) {
        queue.length = 0;
        if (job.requestId) void port.cancel(job.request.hostId, job.requestId).catch(() => {});
        publish({
          error:
            "Speech playback failed. Check the host speech settings; browsers may also require a playback gesture.",
          errorKey: request.key,
        });
      }
    } finally {
      if (current === job) {
        current = null;
        publish({ key: null, hostId: null, itemId: null, phase: "idle" });
        void drain();
      }
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    speak(request: SpeechPlaybackRequest) {
      if (closed || occupied()) return;
      if (!request.text.trim() || request.text.length > 65536) {
        publish({
          error: "Choose a non-empty reply of at most 65,536 characters to read aloud.",
          errorKey: request.key,
        });
        return;
      }
      // Manual playback owns the speaker; new automatic material arriving while
      // it plays is consumed by the producer, never saved as a stale backlog.
      if (request.automatic && current && !current.request.automatic) return;
      if (!request.automatic) stop();
      if (
        queue.length >= 32 ||
        current?.request.key === request.key ||
        queue.some((entry) => entry.key === request.key)
      )
        return;
      queue.push(request);
      void drain();
    },
    stop,
    retainCapture() {
      captures++;
      stop();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        captures--;
      };
    },
    cancelKey(key: string) {
      for (let index = queue.length - 1; index >= 0; index--)
        if (queue[index]?.key.startsWith(key)) queue.splice(index, 1);
      if (current?.request.key.startsWith(key)) {
        const pending = [...queue];
        stop();
        queue.push(...pending);
        void drain();
      }
    },
    cancelCues() {
      for (let index = queue.length - 1; index >= 0; index--)
        if (queue[index]?.cue) queue.splice(index, 1);
      if (current?.request.cue) {
        const pending = [...queue];
        stop();
        queue.push(...pending);
        void drain();
      }
    },
    reconcile() {
      if (occupied()) stop();
      else if (current && !port.available(current.request.hostId)) stop();
      else void drain();
    },
    close() {
      closed = true;
      stop();
      listeners.clear();
    },
  };
}
export type SpeechPlayback = ReturnType<typeof createSpeechPlayback>;
