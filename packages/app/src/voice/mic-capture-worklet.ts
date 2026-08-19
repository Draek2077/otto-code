/**
 * Mic capture on an AudioWorklet, shared by the web audio engine and the web
 * dictation source.
 *
 * Both paths used to capture through `context.createScriptProcessor(4096, 1, 1)`
 * plus an `onaudioprocess` resample, which Chromium logs as deprecated
 * ("The ScriptProcessorNode is deprecated. Use AudioWorkletNode instead") once
 * per engine instance. This module is the worklet replacement:
 *
 *  - `MIC_CAPTURE_WORKLET_SOURCE` is a self-contained module string loaded with
 *    `context.audioWorklet.addModule(URL.createObjectURL(new Blob(...)))` - no
 *    network fetch. The renderer CSP already allows `blob:` for workers
 *    (`worker-src 'self' blob:`), and neither Electron (otto:// static assets)
 *    nor Expo web has a script asset the renderer could fetch instead.
 *  - The worklet runs the DSP on the render thread (RMS meter + the 16 kHz
 *    PCM16 downsample) and posts one message per rendered frame. The main
 *    thread receives the SAME shape the legacy `onaudioprocess` handler consumed
 *    (`event.inputBuffer.getChannelData(0)` → 16 kHz PCM16), so the handler
 *    function - proof-of-life tick, meter normalization, mute gate - is shared
 *    between the worklet path and the ScriptProcessor fallback.
 *
 * The worklet posts on EVERY rendered frame regardless of mute - mute is an
 * upstream decision (the handler skips the data delivery) - because the engine's
 * capture-liveness watchdog uses "a frame arrived" as its proof of life, and
 * muting must never look like a stall.
 */

export const MIC_CAPTURE_WORKLET_NAME = "otto-mic-capture";
/** Capture contract: single-channel 16 kHz little-endian PCM16. */
export const CAPTURE_TARGET_SAMPLE_RATE = 16000;

export interface MicCaptureWorkletMessage {
  /** Root-mean-square of the frame, 0..1 (may exceed 1 for clipped input). */
  rms: number;
  /** 16 kHz PCM16 little-endian bytes for this frame (empty for an empty frame). */
  pcm: Uint8Array;
}

/** Clamp a float sample to [-1, 1] and map it onto the signed 16-bit range. */
export function floatToInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

/**
 * Stateless linear-interpolation downsample to `outputRate` PCM16.
 *
 * The worklet invokes this once per rendered frame (a 128-sample chunk at a
 * 48 kHz context), so each call resamples a self-contained slice - the same
 * per-block behavior the legacy `onaudioprocess` resampler had, just at finer
 * block boundaries. The consumers re-chunk to their own cadence anyway (the
 * dictation path accumulates to 16 kHz-second chunks; the voice runtime base64s
 * and sends whatever arrives), so the finer seams are inaudible.
 */
export function resampleToPcm16Float(
  input: Float32Array,
  inputRate: number,
  outputRate: number,
): Int16Array {
  if (input.length === 0) {
    return new Int16Array(0);
  }
  if (inputRate === outputRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      out[i] = floatToInt16(input[i]);
    }
    return out;
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio;
    const i0 = Math.floor(sourceIndex);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const frac = sourceIndex - i0;
    const sample = input[i0] * (1 - frac) + input[i1] * frac;
    out[i] = floatToInt16(sample);
  }
  return out;
}

/** Root-mean-square of a frame, the value the meter callbacks report raw. */
export function computeRms(input: Float32Array): number {
  if (input.length === 0) {
    return 0;
  }
  let sumSquares = 0;
  for (let i = 0; i < input.length; i += 1) {
    const sample = input[i];
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / Math.max(1, input.length));
}

/**
 * The worklet's `process()` body as a SELF-CONTAINED function: it must not
 * reference any outer-scope identifier, because it is serialized into the
 * module string with `Function.prototype.toString()` and evaluated on the
 * worklet thread where the app's module scope does not exist. Everything it
 * needs (floatToInt16, the resampler, the RMS) is declared inside it.
 */
export function micCaptureWorkletProcessBody(
  inputs: Float32Array[][],
  sampleRate: number,
): { rms: number; pcm: Uint8Array; transfer: Transferable[] } {
  // Local mirrors so the serialized body is fully self-contained (no closures).
  const toI16 = (s: number): number => {
    const c = Math.max(-1, Math.min(1, s));
    return c < 0 ? Math.round(c * 0x8000) : Math.round(c * 0x7fff);
  };
  const rmsOf = (x: Float32Array): number => {
    if (x.length === 0) {
      return 0;
    }
    let sumSquares = 0;
    for (let i = 0; i < x.length; i += 1) {
      const s = x[i];
      sumSquares += s * s;
    }
    return Math.sqrt(sumSquares / Math.max(1, x.length));
  };

  const channel = inputs[0] && inputs[0][0] ? inputs[0][0] : null;
  const frame = channel ? new Float32Array(channel) : new Float32Array(0);
  const rms = rmsOf(frame);

  const outRate = 16000;
  let pcm: Int16Array;
  if (frame.length === 0) {
    pcm = new Int16Array(0);
  } else if (sampleRate === outRate) {
    pcm = new Int16Array(frame.length);
    for (let i = 0; i < frame.length; i += 1) {
      pcm[i] = toI16(frame[i]);
    }
  } else {
    const ratio = sampleRate / outRate;
    const n = Math.max(1, Math.round(frame.length / ratio));
    pcm = new Int16Array(n);
    for (let i = 0; i < n; i += 1) {
      const si = i * ratio;
      const i0 = Math.floor(si);
      const i1 = Math.min(frame.length - 1, i0 + 1);
      const f = si - i0;
      pcm[i] = toI16(frame[i0] * (1 - f) + frame[i1] * f);
    }
  }

  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return { rms, pcm: bytes, transfer: [bytes.buffer] };
}

/**
 * The worklet module as one self-contained string. It is never imported by the
 * app - only turned into a Blob URL - so it is plain text with the serialized
 * process body spliced in, keeping the minifier/bundler out of it entirely.
 * The body is self-contained (see micCaptureWorkletProcessBody) so the string
 * evaluates on the worklet thread with no app scope.
 */
export const MIC_CAPTURE_WORKLET_SOURCE: string =
  `// Otto mic-capture AudioWorklet module, generated inline from\n` +
  `// voice/mic-capture-worklet.ts. Do not edit by hand - the process body is\n` +
  `// serialized from the tested source with Function.prototype.toString().\n` +
  `const micCaptureProcess = ${micCaptureWorkletProcessBody.toString()};\n` +
  `registerProcessor("${MIC_CAPTURE_WORKLET_NAME}", class extends AudioWorkletProcessor {\n` +
  `  process(inputs) {\n` +
  // `sampleRate` and `this.port` - not `this.currentContext` / `this.postMessage`,
  // neither of which exists on AudioWorkletProcessor - are how AudioWorkletGlobalScope
  // exposes the context rate and the main-thread channel.
  `    const r = micCaptureProcess(inputs, sampleRate);\n` +
  // Send the Uint8Array itself (not `.buffer`) - structured clone preserves
  // the typed-array wrapper across the port while `transfer` still moves the
  // backing ArrayBuffer zero-copy. The main thread's `data.pcm instanceof
  // Uint8Array` check requires the view, not the raw buffer.
  `    this.port.postMessage({ rms: r.rms, pcm: r.pcm }, r.transfer);\n` +
  `    return true;\n` +
  `  }\n` +
  `});\n`;

/**
 * Create the Blob-URL module for `context.audioWorklet.addModule()`. Returns
 * the URL so the caller can revoke it once the capture session is torn down -
 * a worklet URL must not outlive the context that loaded it.
 */
export function createMicCaptureWorkletModule(context: AudioContext): Promise<string> {
  const blob = new Blob([MIC_CAPTURE_WORKLET_SOURCE], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  return context.audioWorklet
    .addModule(url)
    .then(() => url)
    .catch((error) => {
      URL.revokeObjectURL(url);
      throw error;
    });
}

/**
 * Main-thread handle for one capture worklet node. Presents the legacy
 * `processor.onaudioprocess = (event) => ...` surface by delivering
 * `event.inputBuffer.getChannelData(0)` (16 kHz PCM16 bytes) plus the frame RMS
 * from the worklet's per-frame messages, so the same handler function can drive
 * both capture paths.
 */
export interface MicCaptureFrameEvent {
  /**
   * Legacy-shaped buffer. `getChannelData(0)` returns the 16 kHz PCM16 bytes
   * for this frame (a Uint8Array view standing in for the Float32 channel the
   * ScriptProcessor path delivered); `sampleRate` is the target rate.
   */
  inputBuffer: {
    getChannelData(channel: number): Uint8Array;
    sampleRate: number;
  };
  /** Raw frame RMS, 0..1 - the worklet computed it on the render thread. */
  rms: number;
}

export class MicCaptureProcessor {
  private readonly node: AudioWorkletNode;
  private readonly url: string;
  private readonly onError?: (error: Error) => void;
  private handler: ((event: MicCaptureFrameEvent) => void) | null = null;
  private disposed = false;

  constructor(
    context: AudioContext,
    source: MediaStreamAudioSourceNode,
    url: string,
    onError?: (error: Error) => void,
  ) {
    this.url = url;
    this.onError = onError;
    this.node = new AudioWorkletNode(context, MIC_CAPTURE_WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    });
    this.node.port.addEventListener("message", this.handlePortMessage);
    this.node.port.start();
    source.connect(this.node);
  }

  private readonly handlePortMessage = (event: MessageEvent): void => {
    const data = event.data as MicCaptureWorkletMessage | undefined;
    if (
      !data ||
      typeof data.rms !== "number" ||
      !(data.pcm instanceof Uint8Array) ||
      !this.handler
    ) {
      return;
    }
    try {
      this.handler({
        inputBuffer: { getChannelData: () => data.pcm, sampleRate: CAPTURE_TARGET_SAMPLE_RATE },
        rms: data.rms,
      });
    } catch (error) {
      this.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };

  set onaudioprocess(handler: ((event: MicCaptureFrameEvent) => void) | null) {
    this.handler = handler;
  }

  /** Route the worklet's (silent) output node downstream, mirroring `AudioNode#connect`. */
  connect(destination: AudioNode): void {
    this.node.connect(destination);
  }

  /**
   * Tear down the node and revoke the module URL. The module is cached per
   * AudioContext by the browser, but the URL must not leak with the session.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.handler = null;
    this.node.port.removeEventListener("message", this.handlePortMessage);
    try {
      this.node.disconnect();
    } catch {
      // Ignore best-effort teardown errors.
    }
    URL.revokeObjectURL(this.url);
  }
}
