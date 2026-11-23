import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import type { Page, TestInfo } from "@playwright/test";

/** Capture before fixture cleanup removes its project. File-backed evidence
 * remains in the uploaded output directory, outside Playwright's hidden files.
 */
export async function captureSpeechEvidence(
  page: Page,
  info: TestInfo,
  read: () => Promise<unknown>,
) {
  await page
    .screenshot({ path: info.outputPath("speech-before-cleanup.png"), fullPage: true })
    .catch(() => undefined);
  await page
    .locator("body")
    .innerText()
    .then((body) => writeFile(info.outputPath("speech-before-cleanup.txt"), body))
    .catch(() => undefined);
  await read()
    .then((value) =>
      writeFile(info.outputPath("speech-host-state.json"), JSON.stringify(value, null, 2)),
    )
    .catch(() => undefined);
}
/** Real HTTP boundary for CI speech acceptance. Silence is intentional: the
 * browser decodes/plays a real PCM16 WAV without a vendor account or microphone.
 */
export async function createSpeechHttpFixture() {
  const requests: Record<string, unknown>[] = [];
  let rejectNext = false;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      response.writeHead(400);
      response.end();
      return;
    }
    requests.push(Object.fromEntries(Object.entries(body)));
    if (rejectNext) {
      rejectNext = false;
      response.writeHead(400, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: {
            message: "Isolated speech fixture rejected this request",
            type: "invalid_request_error",
          },
        }),
      );
      return;
    }
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.end(Buffer.alloc(24000 * 2 * 3));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing speech fixture address");
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    failNext() {
      rejectNext = true;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
