import { afterEach, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import pino from "pino";
import { OpenAITTS } from "../../speech/providers/openai/tts.js";
import { nodeSpeechStream } from "./api-stream.js";

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it("cancels a pending standard reader and releases its lock when playback stops", async () => {
  let cancellations = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
    },
    cancel() {
      cancellations++;
    },
  });
  const stream = nodeSpeechStream(body);
  const first = once(stream, "data");
  stream.resume();
  expect(Buffer.from((await first)[0])).toEqual(Buffer.from([1, 2]));
  const closed = once(stream, "close");
  stream.destroy();
  await closed;
  expect(cancellations).toBe(1);
  expect(body.locked).toBe(false);
});
it("streams the first bytes before synthesis completes and sends selected voice/model/speed", async () => {
  let finish: () => void = () => {};
  const tail = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const requests: unknown[] = [];
  const server = createServer(async (request, response) => {
    const body: Buffer[] = [];
    for await (const chunk of request) body.push(Buffer.from(chunk));
    requests.push(JSON.parse(Buffer.concat(body).toString()));
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.write(Buffer.from([1, 2]));
    await tail;
    response.end(Buffer.from([3, 4]));
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  const provider = new OpenAITTS(
    {
      apiKey: "fixture-only",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      model: "FixtureModel",
      voice: "FixtureVoice",
      speed: 0.75,
    },
    pino({ level: "silent" }),
  );
  try {
    const audio = await provider.synthesizeSpeech("A short sentence.");
    const iterator = audio.stream[Symbol.asyncIterator]();
    expect(Buffer.from((await iterator.next()).value)).toEqual(Buffer.from([1, 2]));
    expect(requests).toEqual([
      {
        model: "FixtureModel",
        voice: "FixtureVoice",
        input: "A short sentence.",
        speed: 0.75,
        response_format: "pcm",
      },
    ]);
    finish();
    expect(Buffer.from((await iterator.next()).value)).toEqual(Buffer.from([3, 4]));
    expect((await iterator.next()).done).toBe(true);
  } finally {
    finish();
  }
});
