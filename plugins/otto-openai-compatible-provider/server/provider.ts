import { z } from "zod";
import { createHash } from "node:crypto";
import {
  negotiateProviderCapabilities,
  requireProviderCapabilities,
  type ProviderConnection,
  type ProviderEvent,
  type ProviderInput,
  type ProviderRegistration,
} from "@getpaseo/plugin/server/provider";
import type { ConnectionSettings } from "../shared/settings.js";
import { endpoint, readBody, requireOk } from "./http.js";
import { OpenAiSession } from "./session.js";

const capabilities = [
  "prompt.message",
  "prompt.image",
  "session.persistence",
  "permission",
  "permission.tool_policy",
] as const;

export function createOpenAiProvider(
  readSettings: () => Promise<ConnectionSettings>,
  options: { imageDirectory?: string } = {},
): ProviderRegistration {
  return {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    description: "Use a local or hosted OpenAI-compatible Chat Completions endpoint with Otto.",
    async getCatalogCacheKey() {
      const settings = await readSettings();
      return createHash("sha256")
        .update(
          JSON.stringify([
            settings.baseUrl,
            settings.model,
            settings.apiKeyEnv,
            process.env[settings.apiKeyEnv],
          ]),
        )
        .digest("hex");
    },
    async status() {
      const settings = await readSettings();
      return settings.baseUrl
        ? { available: true }
        : {
            available: false,
            diagnostic: "Configure the endpoint in Settings > Plugins > Otto OpenAI-compatible.",
          };
    },
    async connect(request) {
      if (!request.versions.includes(1))
        throw new Error("Provider protocol version 1 is required.");
      return connection(
        readSettings,
        negotiateProviderCapabilities(
          request.capabilities,
          options.imageDirectory
            ? capabilities
            : capabilities.filter((capability) => capability !== "prompt.image"),
        ),
        options.imageDirectory,
      );
    },
  };
}

function connection(
  readSettings: () => Promise<ConnectionSettings>,
  supported: readonly string[],
  imageDirectory?: string,
): ProviderConnection {
  const listeners = new Set<(event: ProviderEvent) => void>();
  const sessions = new Map<string, OpenAiSession>();
  const opening = new Set<string>();
  const lifecycle = new AbortController();
  let closed = false;
  let closing: Promise<void> | null = null;
  const emit = (event: ProviderEvent) => {
    if (!closed) for (const listener of listeners) listener(event);
  };
  const session = (id: string) => {
    const value = sessions.get(id);
    if (!value) throw new Error(`Unknown provider session: ${id}`);
    return value;
  };
  async function dispatch(input: ProviderInput): Promise<void> {
    switch (input.type) {
      case "catalog": {
        const settings = await readSettings();
        if (!settings.baseUrl) throw new Error("Configure an OpenAI-compatible endpoint first.");
        let models = settings.model ? [{ id: settings.model, label: settings.model }] : [];
        if (!models.length) {
          const apiKey = process.env[settings.apiKeyEnv];
          const response = await fetch(endpoint(settings.baseUrl, "models"), {
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
            redirect: "error",
            signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(settings.timeoutMs)]),
          });
          await requireOk(response, "Model discovery", apiKey);
          models = z
            .object({ data: z.array(z.object({ id: z.string().min(1) })) })
            .parse(JSON.parse(await readBody(response)))
            .data.map(({ id }) => ({ id, label: id }));
        }
        if (!models.length)
          throw new Error(
            "The endpoint has no available models. Load a model on that host or configure its model ID.",
          );
        emit({
          type: "catalog",
          requestId: input.requestId,
          catalog: {
            models,
            modes: [{ id: "default", label: "Ask before tools" }],
            defaultModel: models[0]!.id,
            defaultMode: "default",
          },
        });
        return;
      }
      case "session.open": {
        const settings = await readSettings();
        const value = new OpenAiSession(
          input.sessionId,
          input.config,
          settings,
          emit,
          input.persistence,
          supported.includes("permission"),
          imageDirectory,
        );
        await value.prepare(lifecycle.signal);
        if (closed || closing) {
          await value.close();
          return;
        }
        sessions.set(input.sessionId, value);
        emit({
          type: "session.opened",
          requestId: input.requestId,
          sessionId: input.sessionId,
          capabilities: supported,
          restoration: "core",
          cwd: input.config.cwd,
          ...(input.config.title ? { title: input.config.title } : {}),
        });
        if (input.history === "replay")
          for (const item of value.timeline.values())
            emit({ type: "timeline.item", sessionId: input.sessionId, item });
        emit({
          type: "session.config",
          sessionId: input.sessionId,
          config: {
            model: input.config.model,
            mode: "default",
            models: [{ id: input.config.model!, label: input.config.model! }],
            modes: [{ id: "default", label: "Ask before tools" }],
            thinkingOptions: [],
            settings: [],
          },
        });
        emit({ type: "session.ready", requestId: input.requestId, sessionId: input.sessionId });
        opening.delete(input.sessionId);
        return;
      }
      case "session.prompt":
        session(input.sessionId).start(input.prompt);
        return;
      case "session.permission":
        session(input.sessionId).respond(input.permissionId, input.response);
        return;
      case "session.interrupt":
        await session(input.sessionId).interrupt();
        emit({ type: "request.completed", requestId: input.requestId });
        return;
      case "session.close":
        await session(input.sessionId).close();
        sessions.delete(input.sessionId);
        emit({ type: "session.closed", sessionId: input.sessionId });
        emit({ type: "request.completed", requestId: input.requestId });
        return;
      default:
        throw new Error(`Provider operation ${input.type} is not supported by this slice.`);
    }
  }
  return {
    version: 1,
    capabilities: supported,
    async send(input) {
      if (closed || closing) throw new Error("The provider connection is closed.");
      requireProviderCapabilities(supported, input);
      if (input.type === "session.open") {
        if (sessions.has(input.sessionId) || opening.has(input.sessionId))
          throw new Error("This provider session is already open.");
        opening.add(input.sessionId);
      } else if ("sessionId" in input) session(input.sessionId);
      void dispatch(input).catch((error: unknown) => {
        if (input.type === "session.open") opening.delete(input.sessionId);
        const failure = { message: error instanceof Error ? error.message : String(error) };
        if ("requestId" in input)
          emit({ type: "request.failed", requestId: input.requestId, error: failure });
        else if (input.type === "session.prompt")
          emit({
            type: "session.prompt_result",
            sessionId: input.sessionId,
            clientMessageId: input.prompt.clientMessageId,
            result: { type: "failed", error: failure },
          });
      });
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      if (closing) return closing;
      closing = (async () => {
        lifecycle.abort();
        await Promise.all([...sessions.values()].map((value) => value.close()));
        closed = true;
        sessions.clear();
        listeners.clear();
      })();
      return closing;
    },
  };
}
