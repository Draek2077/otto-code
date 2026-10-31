import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { ManagedSpeechRuntime } from "./managed-runtime.js";
import { SpeechRequests } from "./requests.js";
const logger = pino({ level: "silent" });
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
});
async function fixture() {
  const requests: { url: string; body: string }[] = [];
  const held: ServerResponse[] = [];
  let hold = false;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({ url: request.url ?? "", body: Buffer.concat(chunks).toString() });
    if (request.url?.endsWith("/transcriptions")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ text: "Fixture transcription.", language: "fr" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.write(Buffer.from([1, 0, 2, 0]));
    if (hold) held.push(response);
    else response.end(Buffer.from([3, 0, 4, 0]));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const selected = { provider: "openai", explicit: true, enabled: true } as const;
  const runtime = new ManagedSpeechRuntime(
    {
      openai: {
        stt: {
          apiKey: "fixture-only",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          model: "whisper-1",
        },
        tts: {
          apiKey: "fixture-only",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          model: "FixtureModel",
          voice: "FixtureVoice",
        },
      },
      speech: {
        providers: {
          dictationStt: selected,
          voiceStt: selected,
          voiceTts: selected,
          voiceTurnDetection: selected,
        },
        sttLanguages: { dictation: "fr", voice: "fr" },
      },
    },
    logger,
  );
  runtime.start();
  await runtime.ready;
  const speech = new SpeechRequests(runtime, logger);
  cleanups.push(async () => {
    speech.close();
    await runtime.stop();
  });
  const synthesize = (clientId: string, requestId: string) =>
    speech.synthesize({
      clientId,
      requestId,
      text: "A short fixture sentence.",
      selection: { provider: "openai", model: "FixtureModel", voice: "FixtureVoice", speed: 0.75 },
      modelsDir: "unused",
    });
  return {
    runtime,
    speech,
    requests,
    synthesize,
    hold() {
      hold = true;
    },
    release() {
      for (const response of held.splice(0)) response.end(Buffer.from([3, 0]));
    },
  };
}
describe("speech HTTP contract", () => {
  it("returns playable WAV through the real SDK with exact model, voice and speed, without requiring realtime VAD", async () => {
    const f = await fixture();
    expect(f.runtime.getReadiness().realtimeVoice.available).toBe(false);
    const output = await f.synthesize("client", "one");
    const wav = Buffer.from(output.base64, "base64");
    expect(output.mimeType).toBe("audio/wav");
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.subarray(44)).toEqual(Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]));
    expect(JSON.parse(f.requests[0]!.body)).toEqual({
      model: "FixtureModel",
      voice: "FixtureVoice",
      speed: 0.75,
      input: "A short fixture sentence.",
      response_format: "pcm",
    });
  });
  it("keeps cancellation client-owned, bounds concurrent generation and releases only the disconnected client's requests", async () => {
    const f = await fixture();
    f.hold();
    const one = f.synthesize("one", "same");
    const rejected = expect(one).rejects.toThrow("stopped");
    const two = f.synthesize("two", "same");
    await expect.poll(() => f.requests.length).toBe(2);
    await expect(f.synthesize("three", "third")).rejects.toThrow("busy");
    expect(f.speech.cancel("other", "same")).toEqual({ accepted: false });
    f.speech.releaseClient("one");
    await rejected;
    f.release();
    expect((await two).mimeType).toBe("audio/wav");
    expect(f.speech.cancel("two", "same")).toEqual({ accepted: false });
  });
  it("sends recorded PCM through the selected recognition model and returns its transcript through the existing session", async () => {
    const f = await fixture();
    const session = f.runtime.resolveDictationStt()!.createSession({ logger, language: "fr" });
    await session.connect();
    const transcript = new Promise<unknown>((resolve, reject) => {
      session.on("transcript", resolve);
      session.on("error", reject);
    });
    session.appendPcm16(Buffer.alloc(2400));
    session.commit();
    expect(await transcript).toMatchObject({
      transcript: "Fixture transcription.",
      isFinal: true,
      language: "fr",
    });
    expect(f.requests[0]!.url).toBe("/v1/audio/transcriptions");
    expect(f.requests[0]!.body).toContain('name="model"\r\n\r\nwhisper-1');
    expect(f.requests[0]!.body).toContain('name="language"\r\n\r\nfr');
    session.close();
  });
});
