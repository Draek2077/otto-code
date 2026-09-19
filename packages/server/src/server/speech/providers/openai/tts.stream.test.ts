import http from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import { OpenAITTS } from "./tts.js";

// The real SDK against a real local server: the speech response starts
// streaming and never finishes, the way long speech looks mid-synthesis.
interface HeldSpeechServer {
  baseUrl: string;
  responseClosed: Promise<void>;
  close: () => Promise<void>;
}

async function startHeldSpeechServer(firstChunk: Buffer): Promise<HeldSpeechServer> {
  let resolveClosed: () => void = () => {};
  const responseClosed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const server = http.createServer((req, res) => {
    req.resume();
    res.on("close", resolveClosed);
    res.writeHead(200, { "content-type": "audio/pcm" });
    res.write(firstChunk);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    responseClosed,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

describe("OpenAITTS speech stream", () => {
  let server: HeldSpeechServer | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  test("hands on a Node stream whose destroy cancels the in-flight response", async () => {
    const firstChunk = Buffer.from("PCM-CHUNK-1");
    server = await startHeldSpeechServer(firstChunk);
    const provider = new OpenAITTS(
      { apiKey: "sk-test", baseUrl: server.baseUrl },
      pino({ level: "silent" }),
    );

    const { stream } = await provider.synthesizeSpeech("hello");

    expect(stream).toBeInstanceOf(Readable);
    const received = await new Promise<Buffer>((resolve) =>
      stream.once("data", (chunk: Buffer) => resolve(chunk)),
    );
    expect(Buffer.from(received).toString()).toBe("PCM-CHUNK-1");

    // What the TTS manager does when speech is interrupted.
    stream.destroy();
    await server.responseClosed;
  });
});
