import { isElectronRuntime } from "@/desktop/host";
import type {
  AudioEngine,
  AudioEngineCallbacks,
  AudioPlaybackSource,
} from "@/voice/audio-engine-types";

interface QueuedAudio {
  audio: AudioPlaybackSource;
  resolve: (duration: number) => void;
  reject: (error: Error) => void;
}

// Capture-liveness watchdog. A ScriptProcessorNode stops firing
// `onaudioprocess` the moment its AudioContext is suspended (tab/OS audio-focus
// changes) or its MediaStream track ends (Bluetooth switch, device unplug, OS
// reclaim). Nothing wakes it back up on its own, so the mic goes silent and the
// user has to stop + restart voice mode — exactly the "input dropped" wedge.
// While capturing we poll: resume a suspended context, and if no audio frame has
// arrived within the stall window, rebuild the capture graph in place so voice
// self-heals instead of dying.
const CAPTURE_WATCHDOG_INTERVAL_MS = 1000;
const CAPTURE_STALL_TIMEOUT_MS = 3000;

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }
  const browserWindow = window as typeof window & {
    webkitAudioContext?: typeof AudioContext;
  };
  return browserWindow.AudioContext ?? browserWindow.webkitAudioContext ?? null;
}

function floatToInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

function resampleToPcm16(input: Float32Array, inputRate: number, outputRate: number): Uint8Array {
  if (input.length === 0) {
    return new Uint8Array(0);
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio;
    const i0 = Math.floor(sourceIndex);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const frac = sourceIndex - i0;
    const sample = input[i0] * (1 - frac) + input[i1] * frac;
    output[i] = floatToInt16(sample);
  }

  return new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
}

function parsePcmSampleRate(mimeType: string): number | null {
  const match = /rate=(\d+)/i.exec(mimeType);
  if (!match) {
    return null;
  }
  const rate = Number(match[1]);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function pcm16LeToAudioBuffer(
  context: AudioContext,
  bytes: Uint8Array,
  sampleRate: number,
): AudioBuffer {
  const sampleCount = Math.floor(bytes.length / 2);
  const audioBuffer = context.createBuffer(1, sampleCount, sampleRate);
  const channel = audioBuffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i += 1) {
    const lo = bytes[i * 2];
    const hi = bytes[i * 2 + 1];
    let value = (hi << 8) | lo;
    if (value & 0x8000) {
      value -= 0x10000;
    }
    channel[i] = value / 0x8000;
  }
  return audioBuffer;
}

async function decodeAudioData(context: AudioContext, buffer: ArrayBuffer): Promise<AudioBuffer> {
  const maybePromise = context.decodeAudioData(buffer.slice(0));
  if (maybePromise && typeof maybePromise.then === "function") {
    return maybePromise;
  }
  return await new Promise<AudioBuffer>((resolve, reject) => {
    context.decodeAudioData(buffer.slice(0), resolve, reject);
  });
}

export function createAudioEngine(
  callbacks: AudioEngineCallbacks,
  _options?: { traceLabel?: string },
): AudioEngine {
  const refs: {
    playbackContext: AudioContext | null;
    captureContext: AudioContext | null;
    stream: MediaStream | null;
    source: MediaStreamAudioSourceNode | null;
    processor: ScriptProcessorNode | null;
    gain: GainNode | null;
    started: boolean;
    muted: boolean;
    lastCaptureTickAt: number;
    captureWatchdog: ReturnType<typeof setInterval> | null;
    recovering: boolean;
    queue: QueuedAudio[];
    processingQueue: boolean;
    activePlayback: {
      source: AudioBufferSourceNode;
      resolve: (duration: number) => void;
      reject: (error: Error) => void;
      settled: boolean;
    } | null;
  } = {
    playbackContext: null,
    captureContext: null,
    stream: null,
    source: null,
    processor: null,
    gain: null,
    started: false,
    muted: false,
    lastCaptureTickAt: 0,
    captureWatchdog: null,
    recovering: false,
    queue: [],
    processingQueue: false,
    activePlayback: null,
  };

  async function ensurePlaybackContext(): Promise<AudioContext> {
    // A closed context (e.g. after a prior voice session was torn down) can never
    // produce sound again — resume() is a no-op on it and source.start() throws.
    // Drop it and build a fresh one instead of silently returning the dead one.
    if (refs.playbackContext && refs.playbackContext.state !== "closed") {
      if (refs.playbackContext.state === "suspended") {
        await refs.playbackContext.resume().catch(() => undefined);
      }
      return refs.playbackContext;
    }
    refs.playbackContext = null;

    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) {
      throw new Error("AudioContext unavailable");
    }

    const context = new AudioContextCtor();
    if (context.state === "suspended") {
      await context.resume().catch(() => undefined);
    }
    refs.playbackContext = context;
    return context;
  }

  async function ensureCaptureContext(): Promise<AudioContext> {
    if (refs.captureContext) {
      if (refs.captureContext.state === "suspended") {
        await refs.captureContext.resume().catch(() => undefined);
      }
      return refs.captureContext;
    }

    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) {
      throw new Error("AudioContext unavailable");
    }

    const context = new AudioContextCtor();
    if (context.state === "suspended") {
      await context.resume().catch(() => undefined);
    }
    refs.captureContext = context;
    return context;
  }

  async function playAudio(audio: AudioPlaybackSource): Promise<number> {
    const context = await ensurePlaybackContext();
    const arrayBuffer = await audio.arrayBuffer();
    const type = (audio.type || "").toLowerCase();
    const audioBuffer = type.startsWith("audio/pcm")
      ? pcm16LeToAudioBuffer(
          context,
          new Uint8Array(arrayBuffer),
          parsePcmSampleRate(type) ?? 24000,
        )
      : await decodeAudioData(context, arrayBuffer);

    const durationSec = audioBuffer.duration;
    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);

    return await new Promise<number>((resolve, reject) => {
      refs.activePlayback = { source, resolve, reject, settled: false };

      const settle = (fn: () => void) => {
        const active = refs.activePlayback;
        if (!active || active.source !== source || active.settled) {
          return;
        }
        active.settled = true;
        refs.activePlayback = null;
        fn();
      };

      source.addEventListener("ended", () => {
        settle(() => resolve(durationSec));
      });

      try {
        source.start();
      } catch (error) {
        settle(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    });
  }

  async function processQueue(): Promise<void> {
    if (refs.processingQueue || refs.queue.length === 0) {
      return;
    }

    refs.processingQueue = true;
    while (refs.queue.length > 0) {
      const item = refs.queue.shift()!;
      try {
        const duration = await playAudio(item.audio);
        item.resolve(duration);
      } catch (error) {
        item.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    refs.processingQueue = false;
  }

  // Disconnect the capture graph nodes and release the mic stream, WITHOUT
  // touching the AudioContext or the `started`/watchdog state. Used both for a
  // full stop and for an in-place rebuild during watchdog recovery.
  function teardownCaptureNodes(): void {
    try {
      refs.processor?.disconnect();
      refs.source?.disconnect();
      refs.gain?.disconnect();
    } catch {
      // Ignore best-effort teardown errors.
    }

    if (refs.stream) {
      for (const track of refs.stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore best-effort teardown errors.
        }
      }
    }

    refs.stream = null;
    refs.source = null;
    refs.processor = null;
    refs.gain = null;
  }

  async function stopCapture(): Promise<void> {
    refs.started = false;
    stopCaptureWatchdog();
    refs.recovering = false;
    teardownCaptureNodes();
    refs.muted = false;
    callbacks.onVolumeLevel(0);

    const captureContext = refs.captureContext;
    refs.captureContext = null;
    if (captureContext && captureContext.state !== "closed") {
      await captureContext.close().catch(() => undefined);
    }
  }

  // (Re)build the mic → processor → gain graph on the capture context. Shared by
  // startCapture and the watchdog's recovery path. Sets `started` and seeds the
  // liveness clock; the caller owns validation and the watchdog lifecycle.
  async function buildCaptureGraph(): Promise<void> {
    const context = await ensureCaptureContext();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
      },
    });
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const gain = context.createGain();
    gain.gain.value = 0;

    processor.onaudioprocess = (event) => {
      if (!refs.started) {
        return;
      }
      // Proof of life for the watchdog — updated even while muted (audio still
      // flows; mute only suppresses the upstream send), so muting never looks
      // like a stall.
      refs.lastCaptureTickAt = Date.now();

      const input = event.inputBuffer.getChannelData(0);
      let sumSquares = 0;
      for (let i = 0; i < input.length; i += 1) {
        const sample = input[i];
        sumSquares += sample * sample;
      }
      const rms = Math.sqrt(sumSquares / Math.max(1, input.length));
      const normalized = Math.min(1, Math.max(0, rms * 2));
      callbacks.onVolumeLevel(normalized);

      if (refs.muted) {
        return;
      }

      callbacks.onCaptureData(resampleToPcm16(input, context.sampleRate, 16000));
    };

    // A track that ends (device change/unplug/OS reclaim) will never emit audio
    // again — recover immediately rather than waiting out the stall window.
    for (const track of stream.getTracks()) {
      track.addEventListener(
        "ended",
        () => {
          if (refs.started && !refs.recovering) {
            void recoverCapture();
          }
        },
        { once: true },
      );
    }

    source.connect(processor);
    processor.connect(gain);
    gain.connect(context.destination);

    refs.started = true;
    refs.lastCaptureTickAt = Date.now();
    refs.stream = stream;
    refs.source = source;
    refs.processor = processor;
    refs.gain = gain;
  }

  // Rebuild capture in place after the graph goes silent. Keeps the engine's
  // `started` contract intact so the runtime never sees voice "stop"; only
  // surfaces an error (and fully stops) if the rebuild itself fails.
  async function recoverCapture(): Promise<void> {
    if (!refs.started || refs.recovering) {
      return;
    }
    refs.recovering = true;
    try {
      teardownCaptureNodes();
      // A closed context can never resume — drop it so a fresh one is made.
      if (refs.captureContext && refs.captureContext.state === "closed") {
        refs.captureContext = null;
      }
      await buildCaptureGraph();
    } catch (error) {
      const wrapped = error instanceof Error ? error : new Error(String(error));
      await stopCapture();
      callbacks.onError?.(wrapped);
    } finally {
      refs.recovering = false;
    }
  }

  function stopCaptureWatchdog(): void {
    if (refs.captureWatchdog) {
      clearInterval(refs.captureWatchdog);
      refs.captureWatchdog = null;
    }
  }

  function startCaptureWatchdog(): void {
    if (refs.captureWatchdog) {
      return;
    }
    refs.captureWatchdog = setInterval(() => {
      if (!refs.started || refs.recovering) {
        return;
      }
      const context = refs.captureContext;
      if (context && context.state === "suspended") {
        void context.resume().catch(() => undefined);
      }
      if (Date.now() - refs.lastCaptureTickAt > CAPTURE_STALL_TIMEOUT_MS) {
        void recoverCapture();
      }
    }, CAPTURE_WATCHDOG_INTERVAL_MS);
  }

  return {
    async initialize() {
      await ensurePlaybackContext();
    },

    async destroy() {
      this.stop();
      this.clearQueue();
      await stopCapture();

      const playbackContext = refs.playbackContext;
      refs.playbackContext = null;
      if (playbackContext && playbackContext.state !== "closed") {
        await playbackContext.close().catch(() => undefined);
      }
    },

    async startCapture() {
      if (refs.started) {
        return;
      }

      const missingNavigator =
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== "function";
      const secureContext =
        typeof window !== "undefined" && typeof window.isSecureContext === "boolean"
          ? window.isSecureContext
          : true;
      const currentOrigin =
        typeof window !== "undefined" && window.location ? window.location.origin : "unknown";
      const isDesktopApp = isElectronRuntime();

      if (missingNavigator) {
        throw new Error("Microphone capture is not supported in this environment");
      }
      if (!secureContext && !isDesktopApp) {
        throw new Error(
          `Microphone access requires HTTPS or localhost. Current origin: ${currentOrigin}`,
        );
      }

      try {
        await buildCaptureGraph();
        startCaptureWatchdog();
      } catch (error) {
        await stopCapture();
        const wrapped = error instanceof Error ? error : new Error(String(error));
        callbacks.onError?.(wrapped);
        throw wrapped;
      }
    },

    async stopCapture() {
      await stopCapture();
    },

    toggleMute() {
      refs.muted = !refs.muted;
      if (refs.muted) {
        callbacks.onVolumeLevel(0);
      }
      return refs.muted;
    },

    isMuted() {
      return refs.muted;
    },

    async play(audio: AudioPlaybackSource) {
      return await new Promise<number>((resolve, reject) => {
        refs.queue.push({ audio, resolve, reject });
        if (!refs.processingQueue) {
          void processQueue();
        }
      });
    },

    stop() {
      if (refs.activePlayback) {
        const active = refs.activePlayback;
        refs.activePlayback = null;
        try {
          active.source.stop();
        } catch {
          // Ignore best-effort stop errors.
        }
        if (!active.settled) {
          active.settled = true;
          active.reject(new Error("Playback stopped"));
        }
      }
    },

    clearQueue() {
      while (refs.queue.length > 0) {
        refs.queue.shift()!.reject(new Error("Playback stopped"));
      }
      refs.processingQueue = false;
    },

    isPlaying() {
      return refs.activePlayback !== null;
    },
  };
}
