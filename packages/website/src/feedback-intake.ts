import { env } from "cloudflare:workers";

// Anonymous feedback intake for the Otto app's "Send feedback" sheet.
//
// The app POSTs here directly rather than going through its daemon: a report
// about "I can't reach my host" must still be sendable, and no sink here needs
// host credentials. Reporters are anonymous by construction: the only identity
// is whatever they type into the optional contact field.
//
// Kept as a plain fetch handler rather than a TanStack server fn because the
// callers are cross-origin app builds (native, Electron, and web on other
// origins) which need explicit CORS and a stable URL.

export const FEEDBACK_INTAKE_PATH = "/api/feedback";

const MAX_MESSAGE = 4000;
const MAX_CONTEXT = 1800;
const MAX_CONTACT = 200;
const MAX_SOURCE = 60;
const MAX_BODY_BYTES = 16_000;

// Accidents, not adversaries: a stuck client or a double-tap shouldn't be able
// to flood the channel. KV reads are cached and eventually consistent, so
// concurrent requests undercount and this is a soft ceiling by design. A hard
// limit would need Durable Objects (the Rate Limiting binding caps its window
// at 60s and cannot express 5/hour); for a feedback form whose worst case is
// spam in a Discord channel that Discord itself rate-limits, that is not worth
// the extra infrastructure.
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

const FEEDBACK_KINDS = ["bug", "idea", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export interface FeedbackInput {
  kind: FeedbackKind;
  message: string;
  contact?: string;
  context?: string;
  source?: string;
  honeypot?: string;
}

export class FeedbackValidationError extends Error {
  readonly kind = "invalid-input";

  constructor(message: string) {
    super(message);
    this.name = "FeedbackValidationError";
  }
}

function asString(value: unknown, max: number, field: string): string {
  if (typeof value !== "string") throw new FeedbackValidationError(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new FeedbackValidationError(`${field} is too long`);
  return trimmed;
}

function asOptionalString(value: unknown, max: number, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const trimmed = asString(value, max, field);
  return trimmed.length > 0 ? trimmed : undefined;
}

function isFeedbackKind(value: unknown): value is FeedbackKind {
  return typeof value === "string" && (FEEDBACK_KINDS as readonly string[]).includes(value);
}

// Exported for tests: the whole validation contract with no Workers runtime.
export function validateFeedback(raw: unknown): FeedbackInput {
  if (typeof raw !== "object" || raw === null) {
    throw new FeedbackValidationError("invalid input");
  }
  const record = raw as Record<string, unknown>;

  if (!isFeedbackKind(record.kind)) {
    throw new FeedbackValidationError("kind must be bug, idea, or other");
  }

  const message = asString(record.message, MAX_MESSAGE, "message");
  if (message.length === 0) {
    throw new FeedbackValidationError("message required");
  }

  return {
    kind: record.kind,
    message,
    contact: asOptionalString(record.contact, MAX_CONTACT, "contact"),
    context: asOptionalString(record.context, MAX_CONTEXT, "context"),
    source: asOptionalString(record.source, MAX_SOURCE, "source"),
    honeypot: typeof record.honeypot === "string" ? record.honeypot : "",
  };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

const KIND_LABELS: Record<FeedbackKind, string> = {
  bug: "Bug report",
  idea: "Idea",
  other: "Feedback",
};

const KIND_COLORS: Record<FeedbackKind, number> = {
  bug: 0xef4444,
  idea: 0x22c55e,
  other: 0x5865f2,
};

interface DiscordEmbed {
  title?: string;
  description?: string;
  color: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
}

// Exported for tests. Discord caps a field value at 1024 and a description at
// 4096, so the free-text message and the context block each get their own
// embed description instead of being crammed into fields.
export function buildFeedbackEmbeds(input: FeedbackInput): DiscordEmbed[] {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  if (input.contact) {
    fields.push({ name: "Contact", value: truncate(input.contact, 1024), inline: true });
  }
  if (input.source) {
    fields.push({ name: "Source", value: truncate(input.source, 1024), inline: true });
  }

  const primary: DiscordEmbed = {
    title: `Otto: ${KIND_LABELS[input.kind]}`,
    description: truncate(input.message, 4096),
    color: KIND_COLORS[input.kind],
    timestamp: new Date().toISOString(),
  };
  if (fields.length > 0) {
    primary.fields = fields;
  }
  if (!input.contact) {
    primary.footer = { text: "Anonymous, no reply address given" };
  }

  const embeds: DiscordEmbed[] = [primary];
  if (input.context) {
    embeds.push({
      description: `**Context**\n\`\`\`\n${truncate(input.context, 3900)}\n\`\`\``,
      color: KIND_COLORS[input.kind],
    });
  }
  return embeds;
}

function corsHeaders(): Record<string, string> {
  return {
    // App builds call this from native, Electron, and arbitrary web origins;
    // the endpoint is write-only, unauthenticated, and returns no user data,
    // so there is nothing for a restrictive origin list to protect.
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}

function getWebsiteCache(): KVNamespace | null {
  return (env as { WEBSITE_CACHE?: KVNamespace }).WEBSITE_CACHE ?? null;
}

async function isRateLimited(request: Request): Promise<boolean> {
  const cache = getWebsiteCache();
  const ip = request.headers.get("cf-connecting-ip");
  if (!cache || !ip) return false;

  // Fail open: the limiter guards against accidents, and a KV outage must not
  // block feedback delivery or leak an uncaught error to the reporter.
  try {
    const key = `feedback-rate:${ip}`;
    const raw = await cache.get(key);
    const count = raw === null ? 0 : Number.parseInt(raw, 10);
    const current = Number.isFinite(count) ? count : 0;
    if (current >= RATE_LIMIT_MAX) return true;

    await cache.put(key, String(current + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
  } catch {
    return false;
  }
  return false;
}

// Count the bytes actually received instead of trusting content-length, which
// a client can understate. Returns null once the stream exceeds maxBytes.
async function readBodyCapped(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // Best effort; the caller rejects the request either way.
      }
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function handleFeedbackRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method not allowed" }, 405);
  }

  // KV or webhook failures must come back as a controlled JSON error with the
  // CORS headers of the success path, never as the platform's uncaught-exception
  // page (which cross-origin app builds cannot even read).
  try {
    return await handleFeedbackPost(request);
  } catch {
    return jsonResponse({ ok: false, error: "feedback could not be processed" }, 500);
  }
}

async function handleFeedbackPost(request: Request): Promise<Response> {
  // A missing or unparseable content-length is a rejection, not a pass: chunked
  // uploads carry no length, and letting them through would hand request.json()
  // an unbounded body to buffer inside the isolate.
  const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (!Number.isFinite(declaredLength)) {
    return jsonResponse({ ok: false, error: "content-length required" }, 411);
  }
  if (declaredLength > MAX_BODY_BYTES) {
    return jsonResponse({ ok: false, error: "payload too large" }, 413);
  }

  const bodyText = await readBodyCapped(request, MAX_BODY_BYTES);
  if (bodyText === null) {
    return jsonResponse({ ok: false, error: "payload too large" }, 413);
  }

  let input: FeedbackInput;
  try {
    input = validateFeedback(JSON.parse(bodyText));
  } catch (error) {
    const message = error instanceof FeedbackValidationError ? error.message : "invalid input";
    return jsonResponse({ ok: false, error: message }, 400);
  }

  // Bots fill every field they find; a real sheet never sets this one.
  // Answer "ok" so the bot has nothing to tune against.
  if (input.honeypot) {
    return jsonResponse({ ok: true }, 200);
  }

  if (await isRateLimited(request)) {
    return jsonResponse({ ok: false, error: "too many reports, try again later" }, 429);
  }

  const webhookUrl = (env as { FEEDBACK_WEBHOOK_URL?: string }).FEEDBACK_WEBHOOK_URL;
  if (!webhookUrl) {
    // Misconfiguration on our side, not the reporter's problem: say so plainly
    // and never echo the (missing) destination.
    return jsonResponse({ ok: false, error: "feedback is not configured on the server" }, 503);
  }

  let delivery: Response;
  try {
    delivery = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ embeds: buildFeedbackEmbeds(input) }),
    });
  } catch {
    return jsonResponse({ ok: false, error: "could not deliver feedback" }, 502);
  }

  if (!delivery.ok) {
    return jsonResponse({ ok: false, error: "could not deliver feedback" }, 502);
  }

  return jsonResponse({ ok: true }, 200);
}
