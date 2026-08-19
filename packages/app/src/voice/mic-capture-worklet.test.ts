import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAPTURE_TARGET_SAMPLE_RATE,
  MIC_CAPTURE_WORKLET_NAME,
  MIC_CAPTURE_WORKLET_SOURCE,
  MicCaptureProcessor,
  computeRms,
  floatToInt16,
  micCaptureWorkletProcessBody,
  resampleToPcm16Float,
  type MicCaptureFrameEvent,
} from "@/voice/mic-capture-worklet";

function decodeInt16(bytes: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    let value = (bytes[i + 1] << 8) | bytes[i];
    if (value & 0x8000) {
      value -= 0x10000;
    }
    out.push(value);
  }
  return out;
}

// Mirrors AudioWorkletProcessor's real shape: a `port` the browser assigns
// before `process()` is ever called, and nothing else - no `currentContext`,
// no `postMessage`.
class FakeAudioWorkletProcessorBase {
  port: { postMessage: (message: unknown, transfer: Transferable[]) => void } | undefined;
}

/**
 * Evaluates the generated `registerProcessor(...)` call in a sandboxed scope
 * shaped like `AudioWorkletGlobalScope` (the same globals, nothing else) and
 * returns a handle to drive it. `MIC_CAPTURE_WORKLET_SOURCE` is a plain
 * string, never imported or type-checked as code, so a wrong property access
 * (`this.currentContext`, `this.postMessage` - neither exists on
 * `AudioWorkletProcessor`) would pass every other check in this file and only
 * blow up in a real worklet thread, which the unit suite cannot run.
 */
function loadWorkletModule(sampleRate: number): {
  process: (inputs: Float32Array[][]) => boolean;
  posted: { message: { rms: unknown; pcm: unknown }; transfer: Transferable[] }[];
} {
  const registered: { name: string; ctor: new () => FakeAudioWorkletProcessorBase }[] = [];
  const registerProcessor = (name: string, ctor: new () => FakeAudioWorkletProcessorBase) => {
    registered.push({ name, ctor });
  };

  // eslint-disable-next-line no-new-func -- sandboxing the generated worklet module string is the point.
  const loadModule = new Function(
    "registerProcessor",
    "AudioWorkletProcessor",
    "sampleRate",
    MIC_CAPTURE_WORKLET_SOURCE,
  );
  loadModule(registerProcessor, FakeAudioWorkletProcessorBase, sampleRate);

  expect(registered).toHaveLength(1);
  expect(registered[0].name).toBe(MIC_CAPTURE_WORKLET_NAME);

  const instance = new registered[0].ctor();
  // This stub does NOT structured-clone the posted message (a real
  // MessagePort would), so asserting on `posted` checks the exact object
  // `process()` builds - it cannot accidentally pass because cloning coerced
  // a raw buffer into a typed-array-shaped copy.
  const posted: { message: { rms: unknown; pcm: unknown }; transfer: Transferable[] }[] = [];
  instance.port = {
    postMessage: (message, transfer) => {
      posted.push({ message: message as { rms: unknown; pcm: unknown }, transfer });
    },
  };

  return {
    process: (inputs) =>
      (instance as unknown as { process(i: Float32Array[][]): boolean }).process(inputs),
    posted,
  };
}

class FakePort {
  listeners: ((event: MessageEvent) => void)[] = [];
  started = false;
  addEventListener(_type: "message", listener: (event: MessageEvent) => void): void {
    this.listeners.push(listener);
  }
  removeEventListener(_type: "message", listener: (event: MessageEvent) => void): void {
    this.listeners = this.listeners.filter((existing) => existing !== listener);
  }
  start(): void {
    this.started = true;
  }
  emit(data: unknown): void {
    for (const listener of this.listeners) {
      listener({ data } as MessageEvent);
    }
  }
}

class FakeAudioWorkletNode {
  port = new FakePort();
  connect = vi.fn();
  disconnect = vi.fn();
  constructor(
    public context: unknown,
    public name: string,
    public options: unknown,
  ) {}
}

function makeSource() {
  return { connect: vi.fn() } as unknown as MediaStreamAudioSourceNode;
}

let originalAudioWorkletNodeCtor: unknown;

beforeEach(() => {
  originalAudioWorkletNodeCtor = (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode;
  (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = FakeAudioWorkletNode;
});

afterEach(() => {
  (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = originalAudioWorkletNodeCtor;
});

describe("floatToInt16", () => {
  it("maps the unit range onto the signed 16-bit range", () => {
    expect(floatToInt16(0)).toBe(0);
    expect(floatToInt16(1)).toBe(0x7fff);
    expect(floatToInt16(-1)).toBe(-0x8000);
  });

  it("clamps out-of-range input instead of wrapping", () => {
    expect(floatToInt16(2)).toBe(0x7fff);
    expect(floatToInt16(-2)).toBe(-0x8000);
  });
});

describe("resampleToPcm16Float", () => {
  it("passes samples through unchanged when rates match", () => {
    const input = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const out = resampleToPcm16Float(input, 16000, 16000);
    expect(Array.from(out)).toEqual([0, 16384, -16384, 32767, -32768]);
  });

  it("downsamples to the target sample count", () => {
    const input = new Float32Array(128).fill(0.25);
    const out = resampleToPcm16Float(input, 48000, CAPTURE_TARGET_SAMPLE_RATE);
    // 128 samples at 48kHz -> ~43 samples at 16kHz.
    expect(out.length).toBe(Math.round(128 / 3));
  });

  it("returns an empty frame for empty input", () => {
    expect(resampleToPcm16Float(new Float32Array(0), 48000, 16000).length).toBe(0);
  });
});

describe("computeRms", () => {
  it("is zero for silence", () => {
    expect(computeRms(new Float32Array(64))).toBe(0);
  });

  it("is zero for an empty frame", () => {
    expect(computeRms(new Float32Array(0))).toBe(0);
  });

  it("matches the root-mean-square of a known signal", () => {
    const input = new Float32Array([1, -1, 1, -1]);
    expect(computeRms(input)).toBeCloseTo(1, 10);
  });
});

describe("micCaptureWorkletProcessBody", () => {
  it("returns a zero rms and empty pcm when there is no input channel", () => {
    const result = micCaptureWorkletProcessBody([], 48000);
    expect(result.rms).toBe(0);
    expect(result.pcm.length).toBe(0);
    expect(result.transfer).toEqual([result.pcm.buffer]);
  });

  it("resamples the render-quantum frame to the 16 kHz capture rate", () => {
    const frame = new Float32Array(128).fill(0.5);
    const result = micCaptureWorkletProcessBody([[frame]], 48000);
    expect(result.rms).toBeCloseTo(0.5, 5);
    // 128 samples at 48kHz -> 16kHz is a 3:1 decimation.
    expect(decodeInt16(result.pcm).length).toBe(Math.round(128 / 3));
  });

  it("passes samples through unchanged when the context is already 16 kHz", () => {
    const frame = new Float32Array([0.25, -0.25, 0.5, -0.5]);
    const result = micCaptureWorkletProcessBody([[frame]], CAPTURE_TARGET_SAMPLE_RATE);
    expect(decodeInt16(result.pcm)).toEqual([8192, -8192, 16384, -16384]);
  });
});

describe("MIC_CAPTURE_WORKLET_SOURCE", () => {
  it("runs process() without throwing and posts a frame through the port", () => {
    const { process, posted } = loadWorkletModule(48000);
    const frame = new Float32Array(128).fill(0.5);

    expect(() => process([[frame]])).not.toThrow();

    expect(posted).toHaveLength(1);
    expect(posted[0].message.rms).toBeCloseTo(0.5, 5);
  });

  it("posts pcm as a Uint8Array view, not its raw buffer - the receiver gates on `instanceof Uint8Array`", () => {
    // This is the exact shape MicCaptureProcessor.handlePortMessage checks
    // (`data.pcm instanceof Uint8Array`); posting `.buffer` instead silently
    // drops every frame since an ArrayBuffer fails that check.
    const { process, posted } = loadWorkletModule(48000);
    process([[new Float32Array(128).fill(0.5)]]);

    const { pcm } = posted[0].message;
    expect(pcm).toBeInstanceOf(Uint8Array);
    expect(posted[0].transfer[0]).toBe((pcm as Uint8Array).buffer);
    // 128 samples at 48kHz -> 16kHz is a 3:1 decimation.
    expect((pcm as Uint8Array).byteLength / 2).toBe(Math.round(128 / 3));
  });

  it("keeps processing (returns true) so the node is not torn down", () => {
    const { process } = loadWorkletModule(48000);
    expect(process([[new Float32Array(128)]])).toBe(true);
  });
});

/**
 * `createMicCaptureWorkletModule` (Blob URL + `context.audioWorklet.addModule`)
 * only runs for real inside an actual browser - the unit suite runs under
 * Node, which has neither `Blob` object URLs nor a worklet thread to load
 * them into. That half is exercised by the Playwright E2E voice-mode specs
 * instead.
 */
describe("MicCaptureProcessor", () => {
  it("connects the source to the worklet node on construction", () => {
    const source = makeSource();
    const processor = new MicCaptureProcessor({} as AudioContext, source, "blob:fake-url");
    const node = (processor as unknown as { node: FakeAudioWorkletNode }).node;
    expect(source.connect).toHaveBeenCalledWith(node);
    expect(node.port.started).toBe(true);
  });

  it("delivers frames to the handler with the legacy inputBuffer shape", () => {
    const processor = new MicCaptureProcessor({} as AudioContext, makeSource(), "blob:fake-url");
    const node = (processor as unknown as { node: FakeAudioWorkletNode }).node;

    const received: MicCaptureFrameEvent[] = [];
    processor.onaudioprocess = (event) => received.push(event);

    const pcm = new Uint8Array([1, 2, 3, 4]);
    node.port.emit({ rms: 0.42, pcm });

    expect(received).toHaveLength(1);
    expect(received[0].rms).toBe(0.42);
    expect(received[0].inputBuffer.getChannelData(0)).toBe(pcm);
    expect(received[0].inputBuffer.sampleRate).toBe(CAPTURE_TARGET_SAMPLE_RATE);
  });

  it("posts frames while muted - the caller decides whether to act on them", () => {
    // The engine's mute gate lives in the onaudioprocess handler, not here; the
    // processor must keep delivering so the capture-liveness watchdog's proof
    // of life never depends on mute state.
    const processor = new MicCaptureProcessor({} as AudioContext, makeSource(), "blob:fake-url");
    const node = (processor as unknown as { node: FakeAudioWorkletNode }).node;

    const received: MicCaptureFrameEvent[] = [];
    processor.onaudioprocess = (event) => received.push(event);

    node.port.emit({ rms: 0, pcm: new Uint8Array(0) });
    node.port.emit({ rms: 0.9, pcm: new Uint8Array([5, 6]) });

    expect(received).toHaveLength(2);
  });

  it("ignores malformed messages instead of throwing", () => {
    const processor = new MicCaptureProcessor({} as AudioContext, makeSource(), "blob:fake-url");
    const node = (processor as unknown as { node: FakeAudioWorkletNode }).node;
    const handler = vi.fn();
    processor.onaudioprocess = handler;

    expect(() => node.port.emit(null)).not.toThrow();
    expect(() => node.port.emit({ rms: "not-a-number", pcm: new Uint8Array(0) })).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("routes an in-handler error to onError instead of throwing back into the worklet port", () => {
    const onError = vi.fn();
    const processor = new MicCaptureProcessor(
      {} as AudioContext,
      makeSource(),
      "blob:fake-url",
      onError,
    );
    const node = (processor as unknown as { node: FakeAudioWorkletNode }).node;
    processor.onaudioprocess = () => {
      throw new Error("boom");
    };

    expect(() => node.port.emit({ rms: 0.1, pcm: new Uint8Array(0) })).not.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
  });

  it("stops delivering frames and disconnects the node after dispose", () => {
    const processor = new MicCaptureProcessor({} as AudioContext, makeSource(), "blob:fake-url");
    const node = (processor as unknown as { node: FakeAudioWorkletNode }).node;
    const handler = vi.fn();
    processor.onaudioprocess = handler;

    processor.dispose();
    node.port.emit({ rms: 0.5, pcm: new Uint8Array([1]) });

    expect(handler).not.toHaveBeenCalled();
    expect(node.disconnect).toHaveBeenCalled();
  });

  it("is idempotent - a second dispose is a no-op", () => {
    const processor = new MicCaptureProcessor({} as AudioContext, makeSource(), "blob:fake-url");
    const node = (processor as unknown as { node: FakeAudioWorkletNode }).node;
    processor.dispose();
    processor.dispose();
    expect(node.disconnect).toHaveBeenCalledTimes(1);
  });

  it("forwards connect() to the underlying worklet node", () => {
    const processor = new MicCaptureProcessor({} as AudioContext, makeSource(), "blob:fake-url");
    const node = (processor as unknown as { node: FakeAudioWorkletNode }).node;
    const destination = {} as AudioNode;
    processor.connect(destination);
    expect(node.connect).toHaveBeenCalledWith(destination);
  });
});

describe("end-to-end: generated worklet module -> MicCaptureProcessor", () => {
  it("delivers a real process() frame through the receiver unchanged", () => {
    // Runs the actual registerProcessor() body (not a mock of it) and feeds
    // its exact posted message into the real MicCaptureProcessor - this is
    // the seam where the ArrayBuffer/Uint8Array mismatch and the
    // this.currentContext/this.postMessage typos each independently broke
    // capture, and no test that stubs one side of the port would have caught
    // either.
    const { process, posted } = loadWorkletModule(48000);
    const frame = new Float32Array(128).fill(0.5);
    process([[frame]]);

    const processor = new MicCaptureProcessor({} as AudioContext, makeSource(), "blob:fake-url");
    const node = (processor as unknown as { node: FakeAudioWorkletNode }).node;

    const received: MicCaptureFrameEvent[] = [];
    processor.onaudioprocess = (event) => received.push(event);

    node.port.emit(posted[0].message);

    expect(received).toHaveLength(1);
    expect(received[0].rms).toBeCloseTo(0.5, 5);
    expect(received[0].inputBuffer.getChannelData(0)).toBeInstanceOf(Uint8Array);
    expect(received[0].inputBuffer.sampleRate).toBe(CAPTURE_TARGET_SAMPLE_RATE);
  });
});
