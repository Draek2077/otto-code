/** The owning host authenticates; only completion data crosses the private engine hop. */
import http from "node:http";
import { pipeline } from "node:stream/promises";
import type { Model } from "../types.js";
import type { Profile } from "../config/schema.js";
import type { ReasoningTracker } from "./activity.js";

interface PrivateEngine {
  host: string;
  internalPort: number;
  profile: Profile | null;
}

const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function responseHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const blocked = new Set(HOP_HEADERS);
  for (const name of String(headers.connection ?? "").split(","))
    blocked.add(name.trim().toLowerCase());
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !blocked.has(name)));
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function reasoningTemplate(body: Record<string, unknown>, model: Model): void {
  const effort =
    typeof body.reasoning_effort === "string" ? body.reasoning_effort.toLowerCase() : null;
  if (!effort) return;
  delete body.reasoning_effort;
  const template = model.reasoningTemplate;
  if (!template || !model.reasoningEfforts) return;
  const disabled = effort === "off" || effort === "none";
  const enabled =
    effort === "on" || model.reasoningEfforts.some((value) => value.toLowerCase() === effort);
  if (!disabled && !enabled) return;
  const kwargs = record(body.chat_template_kwargs) ? body.chat_template_kwargs : {};
  body.chat_template_kwargs = { ...kwargs, [template.enableThinkingArgument]: !disabled };
  if (enabled && effort !== "on")
    (body.chat_template_kwargs as Record<string, unknown>)[template.effortArgument] = effort;
  else delete (body.chat_template_kwargs as Record<string, unknown>)[template.effortArgument];
}

function systemAddendum(
  body: Record<string, unknown>,
  text: string | null | undefined,
  anthropic: boolean,
): void {
  if (!text) return;
  if (anthropic) {
    if (typeof body.system === "string") body.system = `${body.system}\n\n${text}`;
    else if (Array.isArray(body.system)) body.system = [...body.system, { type: "text", text }];
    else body.system = text;
    return;
  }
  const messages = Array.isArray(body.messages) ? [...body.messages] : [];
  const index = messages.findIndex((message) => record(message) && message.role === "system");
  if (index < 0) messages.unshift({ role: "system", content: text });
  else {
    const message = messages[index] as Record<string, unknown>;
    const content = Array.isArray(message.content)
      ? [...message.content, { type: "text", text }]
      : `${typeof message.content === "string" ? message.content : ""}\n\n${text}`;
    messages[index] = { ...message, content };
  }
  body.messages = messages;
}

export function prepareCompletion(
  body: Record<string, unknown>,
  model: Model,
  profile: Profile | null,
  slot: number | null,
  route: string,
): Buffer {
  const outbound: Record<string, unknown> = { ...body, model: model.id };
  // Clients never select another session's slot. Only the scheduler names it.
  delete outbound.id_slot;
  if (slot !== null) outbound.id_slot = slot;
  reasoningTemplate(outbound, model);
  systemAddendum(outbound, profile?.chatSystemAddendum, route === "/v1/messages");
  return Buffer.from(JSON.stringify(outbound));
}

export async function proxyCompletion(options: {
  engine: PrivateEngine;
  model: Model;
  body: Record<string, unknown>;
  slot: number | null;
  route: string;
  response: http.ServerResponse;
  tracker: ReasoningTracker;
  signal: AbortSignal;
}): Promise<void> {
  const { engine, model, body, slot, route, response, tracker, signal } = options;
  const payload = prepareCompletion(body, model, engine.profile, slot, route);
  const lease = tracker.begin();
  if (slot !== null) lease.setSlot(slot);
  let upstream: http.ClientRequest | undefined;
  try {
    const incoming = await new Promise<http.IncomingMessage>((resolve, reject) => {
      upstream = http.request(
        {
          host: engine.host,
          port: engine.internalPort,
          path: route,
          method: "POST",
          signal,
          headers: {
            "content-type": "application/json",
            "content-length": payload.length,
            "accept-encoding": "identity",
          },
        },
        resolve,
      );
      upstream.once("error", reject);
      upstream.end(payload);
    });
    response.writeHead(incoming.statusCode ?? 502, responseHeaders(incoming.headers));
    incoming.on("data", (chunk: Buffer) => lease.observe(chunk.toString("utf8")));
    await pipeline(incoming, response, { signal });
  } finally {
    upstream?.destroy();
    lease.end();
  }
}
