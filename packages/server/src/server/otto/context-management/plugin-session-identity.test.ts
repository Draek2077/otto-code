import { expect, test } from "vitest";
import type { ProviderEvent, ProviderConnection } from "@getpaseo/plugin/server/provider";
import { PluginAgentClientRegistry } from "../../agent/plugin-provider.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { contextAgents } from "./agents.js";

test("Context uses the active plugin session identity without changing durable chat handles", async () => {
  let listener: ((event: ProviderEvent) => void) | undefined;
  let activeSessionId: string | undefined;
  const connection: ProviderConnection = {
    version: 1,
    capabilities: ["prompt.message", "session.persistence"],
    onEvent(next) {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    async close() {},
    async send(input) {
      if (input.type === "session.open") {
        activeSessionId = input.sessionId;
        listener?.({
          type: "session.opened",
          requestId: input.requestId,
          sessionId: input.sessionId,
          capabilities: ["prompt.message", "session.persistence"],
          restoration: "core",
          cwd: input.config.cwd,
          persistence: { version: 1, data: { nativeArchive: "first" } },
        });
        listener?.({
          type: "session.ready",
          requestId: input.requestId,
          sessionId: input.sessionId,
        });
      } else if (input.type === "session.close") {
        listener?.({ type: "session.closed", sessionId: input.sessionId });
        listener?.({ type: "request.completed", requestId: input.requestId });
      }
    },
  };
  const registry = new PluginAgentClientRegistry(createTestLogger());
  registry.replace([
    {
      id: "fixture-context",
      label: "Fixture",
      async connect() {
        return connection;
      },
    },
  ]);
  const client = registry.clients()["fixture-context"];
  const session = await client.createSession({ provider: "fixture-context", cwd: "/fixture" });
  const live = {
    id: "agent",
    provider: "fixture-context",
    workspaceId: "workspace",
    cwd: "/fixture",
    config: {},
    session,
  };
  const agents = contextAgents(
    { getAgent: () => live, listAgents: () => [live] },
    { get: async () => null, list: async () => [] },
  );
  try {
    const durable = session.describePersistence()?.sessionId;
    expect(durable).toContain("plugin:");
    expect(session.id).toBe(durable);
    expect(durable).not.toBe(activeSessionId);
    expect((await agents.get("agent"))?.sessionId).toBe(activeSessionId);
    listener?.({
      type: "session.persistence",
      sessionId: activeSessionId!,
      persistence: { version: 1, data: { nativeArchive: "second" } },
    });
    expect(session.id).not.toBe(durable);
    expect(session.id).toBe(session.describePersistence()?.sessionId);
    expect((await agents.list())[0].sessionId).toBe(activeSessionId);
  } finally {
    await session.close();
    await registry.shutdown();
  }
});
