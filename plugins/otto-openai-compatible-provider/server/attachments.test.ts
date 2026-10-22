import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import type { ProviderEvent } from "@getpaseo/plugin/server/provider";
import { createOpenAiProvider } from "./provider.js";
import { prepareContent, PromptImages } from "./prompt-content.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close();
});

it("retains attached context and forge metadata while leaving uploaded files for approved host tools", () => {
  const prepared = prepareContent([
    {
      type: "text",
      mimeType: "text/plain",
      title: "Project notes",
      contextKind: "knowledge",
      text: "Use the host-owned configuration.",
      externalResource: {
        provider: "docs",
        providerLabel: "Docs",
        resourceType: "page",
        id: "42",
        identifier: "DOC-42",
        title: "Project notes",
        url: "https://example.test/notes",
      },
    },
    {
      type: "forge_issue",
      mimeType: "application/paseo-forge-issue",
      forge: "bitbucket",
      number: 7,
      title: "Repair initialization",
      url: "https://example.test/issues/7",
      body: "Keep existing state.",
    },
    {
      type: "uploaded_file",
      id: "upload-1",
      fileName: "notes.txt",
      mimeType: "text/plain",
      size: 99,
      path: "/unread/nonexistent/notes.txt",
    },
  ]);
  expect(prepared.images.size).toBe(0);
  expect(prepared.content).toBe(
    "[Project notes]\n[Docs: DOC-42]\nhttps://example.test/notes\nUse the host-owned configuration.\n[Issue #7: Repair initialization]\nhttps://example.test/issues/7\nKeep existing state.\n[Attached file: notes.txt, text/plain, 99 bytes]\nHost path: /unread/nonexistent/notes.txt\nUse an appropriate approved tool to inspect this file.",
  );
});

it("rejects invalid images before accepting them into the model conversation", () => {
  expect(() =>
    prepareContent([{ type: "image", mimeType: "image/svg+xml", data: "aGVsbG8=" }]),
  ).toThrow();
  expect(() => prepareContent([{ type: "image", mimeType: "image/png", data: "aGVsbG8" }])).toThrow(
    "not valid base64",
  );
});

it("refuses changed image bytes after recovery and repairs the blob when it is reattached", async () => {
  const root = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "provider-image-integrity-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const image = prepareContent([{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }]);
  const images = new PromptImages(directory);
  await images.save(image.images, AbortSignal.timeout(5000));
  const hash = [...image.images.keys()][0]!;
  await writeFile(path.join(directory, hash), "changed");
  await expect(
    images.wire([{ role: "user", content: image.content }], AbortSignal.timeout(5000)),
  ).rejects.toThrow("changed on disk");
  await images.save(image.images, AbortSignal.timeout(5000));
  expect(
    await images.wire([{ role: "user", content: image.content }], AbortSignal.timeout(5000)),
  ).toEqual([
    {
      role: "user",
      content: [{ type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } }],
    },
  ]);
});

it("sends image and text content to the model and preserves the multimodal conversation through recovery", async () => {
  const root = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
  await mkdir(root, { recursive: true });
  const imageDirectory = await mkdtemp(path.join(root, "provider-images-"));
  cleanup.push(() => rm(imageDirectory, { recursive: true, force: true }));
  const requests: Array<{ messages: unknown[] }> = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Image inspected." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing endpoint");
  const provider = createOpenAiProvider(
    async () => ({
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      model: "vision",
      apiKeyEnv: "OPENAI_API_KEY",
      maxToolRounds: 3,
      timeoutMs: 5000,
    }),
    { imageDirectory },
  );
  const first = await provider.connect({
    versions: [1],
    capabilities: ["prompt.message", "prompt.image", "session.persistence"],
  });
  cleanup.push(() => first.close());
  expect(first.capabilities).toContain("prompt.image");
  const events: ProviderEvent[] = [];
  first.onEvent((event) => events.push(event));
  const config = {
    cwd: process.cwd(),
    env: {},
    mcpServers: {},
    model: "vision",
    settings: {},
    persist: true,
  };
  await first.send({
    type: "session.open",
    requestId: "open",
    sessionId: "one",
    history: "skip",
    config,
  });
  await expect.poll(() => events.some((event) => event.type === "session.ready")).toBe(true);
  await first.send({
    type: "session.prompt",
    sessionId: "one",
    prompt: {
      clientMessageId: "image",
      delivery: "auto",
      input: {
        type: "message",
        content: [
          { type: "text", text: "Inspect this image" },
          { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
        ],
      },
    },
  });
  await expect
    .poll(() =>
      events.some((event) => event.type === "session.turn" && event.state === "completed"),
    )
    .toBe(true);
  expect(requests[0]!.messages).toEqual([
    {
      role: "user",
      content: [
        { type: "text", text: "Inspect this image" },
        { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
      ],
    },
  ]);
  const saved = events.findLast((event) => event.type === "session.persistence");
  if (saved?.type !== "session.persistence") throw Error("Missing persisted conversation");
  expect(JSON.stringify(saved.persistence)).not.toContain("aGVsbG8=");
  await first.close();
  const second = await provider.connect({
    versions: [1],
    capabilities: ["prompt.message", "prompt.image", "session.persistence"],
  });
  cleanup.push(() => second.close());
  const resumed: ProviderEvent[] = [];
  second.onEvent((event) => resumed.push(event));
  await second.send({
    type: "session.open",
    requestId: "resume",
    sessionId: "two",
    history: "replay",
    config,
    persistence: saved.persistence,
  });
  await expect.poll(() => resumed.some((event) => event.type === "session.ready")).toBe(true);
  await second.send({
    type: "session.prompt",
    sessionId: "two",
    prompt: {
      clientMessageId: "followup",
      delivery: "auto",
      input: { type: "message", content: [{ type: "text", text: "What did I attach?" }] },
    },
  });
  await expect
    .poll(() =>
      resumed.some((event) => event.type === "session.turn" && event.state === "completed"),
    )
    .toBe(true);
  expect(requests[1]!.messages).toEqual([
    ...requests[0]!.messages,
    { role: "assistant", content: "Image inspected." },
    { role: "user", content: "What did I attach?" },
  ]);
});
