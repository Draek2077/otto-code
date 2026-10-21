import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "./test-stubs/cloudflare-workers";
import { FEEDBACK_INTAKE_PATH, handleFeedbackRequest } from "./feedback-intake";

const URL_BASE = `https://otto-code.me${FEEDBACK_INTAKE_PATH}`;
const VALID_BODY = JSON.stringify({ kind: "bug", message: "the sidebar eats my clicks" });

function postRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request(URL_BASE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(new TextEncoder().encode(body).byteLength),
      ...headers,
    },
    body,
  });
}

function streamingPost(totalBytes: number, headers: Record<string, string>): Request {
  const chunk = new Uint8Array(1024).fill(0x61);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const next = chunk.subarray(0, Math.min(chunk.byteLength, totalBytes - sent));
      sent += next.byteLength;
      controller.enqueue(next);
    },
  });
  return new Request(URL_BASE, {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit);
}

function fakeKv(counts: Record<string, string>): KVNamespace {
  return {
    get: async (key: string) => counts[key] ?? null,
    put: async () => {},
  } as unknown as KVNamespace;
}

describe("handleFeedbackRequest", () => {
  let webhook: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    for (const key of Object.keys(env)) delete env[key];
    env.FEEDBACK_WEBHOOK_URL = "https://discord.example/webhook";
    webhook = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", webhook);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a valid report and forwards it to the webhook", async () => {
    const response = await handleFeedbackRequest(postRequest(VALID_BODY));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(webhook).toHaveBeenCalledTimes(1);
  });

  it("rejects a POST with no content-length header", async () => {
    const response = await handleFeedbackRequest(
      streamingPost(64, { "content-type": "application/json" }),
    );
    expect(response.status).toBe(411);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(webhook).not.toHaveBeenCalled();
  });

  it("rejects an unparseable content-length header", async () => {
    const response = await handleFeedbackRequest(
      postRequest(VALID_BODY, { "content-length": "chunked" }),
    );
    expect(response.status).toBe(411);
    expect(webhook).not.toHaveBeenCalled();
  });

  it("rejects a declared length over the cap without reading the body", async () => {
    const response = await handleFeedbackRequest(
      postRequest(VALID_BODY, { "content-length": "20000" }),
    );
    expect(response.status).toBe(413);
    expect(webhook).not.toHaveBeenCalled();
  });

  it("rejects an oversized body even when content-length understates it", async () => {
    const response = await handleFeedbackRequest(
      streamingPost(20_000, { "content-type": "application/json", "content-length": "100" }),
    );
    expect(response.status).toBe(413);
    expect(webhook).not.toHaveBeenCalled();
  });

  it("rate-limits once the KV counter reaches the ceiling", async () => {
    env.WEBSITE_CACHE = fakeKv({ "feedback-rate:203.0.113.9": "5" });
    const response = await handleFeedbackRequest(
      postRequest(VALID_BODY, { "cf-connecting-ip": "203.0.113.9" }),
    );
    expect(response.status).toBe(429);
    expect(webhook).not.toHaveBeenCalled();
  });

  it("fails open and still delivers when KV throws", async () => {
    env.WEBSITE_CACHE = {
      get: async () => {
        throw new Error("kv outage");
      },
      put: async () => {},
    } as unknown as KVNamespace;
    const response = await handleFeedbackRequest(
      postRequest(VALID_BODY, { "cf-connecting-ip": "203.0.113.9" }),
    );
    expect(response.status).toBe(200);
    expect(webhook).toHaveBeenCalledTimes(1);
  });

  it("returns a controlled CORS error when the webhook fetch rejects", async () => {
    webhook.mockRejectedValueOnce(new Error("network down"));
    const response = await handleFeedbackRequest(postRequest(VALID_BODY));
    expect(response.status).toBe(502);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual({ ok: false, error: "could not deliver feedback" });
  });
});
