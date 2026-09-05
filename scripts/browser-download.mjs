import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";

class DownloadError extends Error {
  constructor(message, retryable) {
    super(message);
    this.retryable = retryable;
  }
}

async function downloadOnce(url, destination, timeoutMs) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new DownloadError(
      `HTTP ${response.status} ${response.statusText} from ${url}`,
      response.status === 408 || response.status === 429 || response.status >= 500,
    );
  }
  const length = response.headers.get("content-length");
  const expectedBytes = length === null ? null : Number(length);
  let receivedBytes = 0;
  async function* chunks() {
    for await (const chunk of response.body) {
      receivedBytes += chunk.length;
      yield chunk;
      // Some CDN responses stay open after the complete archive has arrived.
      if (expectedBytes !== null && receivedBytes >= expectedBytes) break;
    }
  }
  await pipeline(Readable.from(chunks()), createWriteStream(destination, { flags: "wx" }));
  if (expectedBytes !== null && receivedBytes !== expectedBytes) {
    throw new DownloadError(
      `Received ${receivedBytes} bytes, expected ${expectedBytes} from ${url}`,
      true,
    );
  }
}

export async function downloadArchive(
  url,
  destination,
  { timeoutMs = 300_000, attempts = 3, retryDelayMs = 1_000, report = console.warn } = {},
) {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await downloadOnce(url, destination, Math.max(1, deadline - Date.now()));
      return;
    } catch (error) {
      await rm(destination, { force: true });
      const retryable =
        error instanceof DownloadError
          ? error.retryable
          : error instanceof TypeError ||
            ["ECONNRESET", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"].includes(
              error.code ?? error.cause?.code,
            );
      const reason = `${error.message}${error.cause?.message ? `: ${error.cause.message}` : ""}`;
      const pause = retryDelayMs * attempt;
      if (!retryable || attempt === attempts || Date.now() + pause >= deadline) {
        throw new Error(`Browser download failed after ${attempt} attempt(s): ${url}: ${reason}`, {
          cause: error,
        });
      }
      report(`[browsers] attempt ${attempt}/${attempts} failed: ${reason}; retrying ${url}`);
      await delay(pause);
    }
  }
}
