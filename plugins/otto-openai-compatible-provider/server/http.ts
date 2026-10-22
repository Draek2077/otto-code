import { apiBaseUrl } from "../shared/settings.js";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export function endpoint(baseUrl: string, operation: string): string {
  const url = new URL(apiBaseUrl.parse(baseUrl));
  return `${url.href.replace(/\/$/, "")}/${operation}`;
}

export async function readBody(response: Response): Promise<string> {
  if (!response.body) throw new Error("The endpoint returned an empty response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("The endpoint response exceeds 2 MiB.");
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function requireOk(response: Response, label: string, apiKey?: string): Promise<void> {
  if (response.ok) return;
  const body = (await readBody(response)).slice(0, 1200);
  const detail = apiKey ? body.replaceAll(apiKey, "[redacted]") : body;
  throw new Error(`${label} returned HTTP ${response.status}: ${detail}`);
}

export async function* serverEvents(response: Response): AsyncGenerator<string> {
  if (!response.body) throw new Error("The endpoint returned an empty event stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      if (buffer.length > MAX_RESPONSE_BYTES) throw new Error("An endpoint event exceeds 2 MiB.");
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (data) yield data;
      }
      if (chunk.done) {
        if (buffer.trim()) throw new Error("The endpoint event stream ended mid-event.");
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
