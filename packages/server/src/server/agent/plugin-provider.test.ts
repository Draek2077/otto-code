import type {
  ProviderConnection,
  ProviderEvent,
  ProviderInput,
  ProviderRegistration,
} from "@getpaseo/plugin/server/provider";
import { describe, expect, test } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import type { AgentStreamEvent } from "./agent-sdk-types.js";
import { PluginAgentClientRegistry } from "./plugin-provider.js";
import { ProviderSubagentStore } from "./provider-subagents/store.js";
import {
  isStaleProviderSessionError,
  StaleProviderSessionError,
} from "./stale-provider-session-error.js";

const CAPABILITIES = [
  "prompt.message",
  "session.configure",
  "session.persistence",
  "session.subsession",
  "permission",
] as const;

interface ProviderHarnessOptions {
  capabilities?: ProviderConnection["capabilities"];
  completeTurn?: boolean;
}

function createProviderHarness(options: ProviderHarnessOptions = {}) {
  let listener: ((event: ProviderEvent) => void) | null = null;
  let closeCount = 0;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const inputs: ProviderInput[] = [];
  const emit = (event: ProviderEvent) => listener?.(event);
  const capabilities = options.capabilities ?? CAPABILITIES;

  const connection: ProviderConnection = {
    version: 1,
    capabilities,
    async send(input) {
      inputs.push(input);
      if (input.type === "catalog") {
        emit({
          type: "catalog",
          requestId: input.requestId,
          catalog: {
            models: [{ id: "plugin-model", label: "Plugin model" }],
            modes: [{ id: "build", label: "Build" }],
            thinkingOptions: [{ id: "deep", label: "Deep" }],
            defaultModel: "plugin-model",
            defaultMode: "build",
            defaultThinkingOption: "deep",
          },
        });
        return;
      }
      if (input.type === "session.open") {
        emit({
          type: "session.opened",
          requestId: input.requestId,
          sessionId: input.sessionId,
          capabilities,
          restoration: "core",
          persistence: { version: 1, data: { token: "root" } },
          cwd: input.config.cwd,
        });
        emit({
          type: "session.config",
          sessionId: input.sessionId,
          config: {
            model: "plugin-model",
            mode: "build",
            models: [{ id: "plugin-model", label: "Plugin model" }],
            modes: [{ id: "build", label: "Build" }],
            thinkingOptions: [],
            settings: [
              {
                type: "select",
                id: "voice",
                label: "Voice",
                value: "direct",
                options: [{ label: "Direct", value: "direct" }],
              },
            ],
          },
        });
        emit({
          type: "session.opened",
          sessionId: "child-1",
          parentSessionId: input.sessionId,
          capabilities: [],
          restoration: "parent",
          title: "Plugin child",
          cwd: input.config.cwd,
        });
        emit({
          type: "timeline.item",
          sessionId: "child-1",
          item: { type: "assistant_message", id: "child-message", text: "Child result" },
        });
        emit({
          type: "session.turn",
          sessionId: "child-1",
          turnId: "child-turn",
          state: "completed",
        });
        emit({ type: "session.ready", sessionId: "child-1" });
        emit({ type: "session.ready", requestId: input.requestId, sessionId: input.sessionId });
        return;
      }
      if (input.type === "session.prompt") {
        emit({
          type: "session.prompt_result",
          sessionId: input.sessionId,
          clientMessageId: input.prompt.clientMessageId,
          result: { type: "turn", turnId: "turn-1" },
        });
        emit({
          type: "session.turn",
          sessionId: input.sessionId,
          turnId: "turn-1",
          state: "started",
        });
        emit({
          type: "timeline.item",
          sessionId: input.sessionId,
          item: { type: "assistant_message", id: "answer", text: "Hel" },
        });
        emit({
          type: "timeline.item",
          sessionId: input.sessionId,
          item: { type: "assistant_message", id: "answer", text: "Hello" },
        });
        emit({
          type: "session.permission",
          sessionId: input.sessionId,
          request: { id: "permission-1", name: "write", kind: "tool" },
        });
        if (options.completeTurn !== false) {
          emit({
            type: "session.turn",
            sessionId: input.sessionId,
            turnId: "turn-1",
            state: "completed",
          });
        }
        return;
      }
      if (input.type === "session.permission") {
        emit({
          type: "session.permission_resolved",
          sessionId: input.sessionId,
          permissionId: input.permissionId,
        });
        return;
      }
      if (input.type === "session.configure") {
        emit({
          type: "session.config",
          sessionId: input.sessionId,
          config: {
            model: input.changes.model ?? "plugin-model",
            mode: "build",
            models: [{ id: "plugin-model", label: "Plugin model" }],
            modes: [{ id: "build", label: "Build" }],
            thinkingOptions: [],
            settings: [],
          },
        });
        emit({ type: "request.completed", requestId: input.requestId });
        return;
      }
      if (input.type === "session.close") {
        emit({ type: "session.closed", sessionId: input.sessionId });
      }
      if ("requestId" in input) {
        emit({ type: "request.completed", requestId: input.requestId });
      }
    },
    onEvent(nextListener) {
      listener = nextListener;
      return () => {
        if (listener === nextListener) listener = null;
      };
    },
    async close() {
      closeCount += 1;
      resolveClosed();
    },
  };

  const registration: ProviderRegistration = {
    id: "plugin-direct",
    label: "Plugin direct",
    async connect() {
      return connection;
    },
  };

  return {
    registration,
    inputs,
    emit,
    closeCount: () => closeCount,
    waitForClose: () => closed,
  };
}

function eventsOfType(events: AgentStreamEvent[], type: AgentStreamEvent["type"]) {
  return events.filter((event) => event.type === type);
}

describe("PluginAgentClientRegistry", () => {
  test("gates persistence operations on negotiated provider capabilities", async () => {
    const harness = createProviderHarness({ capabilities: ["session.persistence"] });
    const registry = new PluginAgentClientRegistry(createTestLogger());
    registry.replace([harness.registration]);
    const client = registry.clients()[harness.registration.id]!;

    await expect(client.isAvailable()).resolves.toBe(true);
    expect(client.capabilities).toMatchObject({
      supportsSessionPersistence: true,
      supportsSessionListing: false,
    });
    await expect(client.listImportableSessions?.()).resolves.toEqual([]);

    const persistence = {
      provider: harness.registration.id,
      sessionId: 'plugin:{"version":1,"data":{"token":"root"}}',
      metadata: { pluginProviderPersistence: { version: 1, data: { token: "root" } } },
    };
    await expect(client.archiveNativeSession?.(persistence)).resolves.toBeUndefined();
    await expect(client.unarchiveNativeSession?.(persistence)).resolves.toBeUndefined();
    expect(harness.inputs).toEqual([]);
    await registry.shutdown();
  });

  test("terminalizes an active turn exactly once when its plugin provider is removed", async () => {
    const harness = createProviderHarness({ completeTurn: false });
    const registry = new PluginAgentClientRegistry(createTestLogger());
    registry.replace([harness.registration]);
    const client = registry.clients()[harness.registration.id]!;
    const session = await client.createSession({
      provider: harness.registration.id,
      cwd: "/workspace",
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    const run = session.run("hello", { clientMessageId: "active-message" });
    void run.catch(() => undefined);
    await expect.poll(() => eventsOfType(events, "turn_started")).toHaveLength(1);

    registry.replace([]);

    await expect
      .poll(() => eventsOfType(events, "turn_failed"))
      .toEqual([
        expect.objectContaining({
          type: "turn_failed",
          provider: harness.registration.id,
          turnId: "turn-1",
          error: "Provider connection closed",
        }),
      ]);
    await expect(run).rejects.toThrow("Provider connection closed");
    await expect.poll(harness.closeCount).toBe(1);

    registry.replace([]);
    expect(eventsOfType(events, "turn_failed")).toHaveLength(1);
  });

  test("closes a stale session after its plugin provider is replaced", async () => {
    const old = createProviderHarness();
    const next = createProviderHarness();
    const registry = new PluginAgentClientRegistry(createTestLogger());

    try {
      registry.replace([old.registration]);

      const stale = await registry.clients()[old.registration.id]!.createSession({
        provider: old.registration.id,
        cwd: "/workspace",
      });
      const persistence = stale.describePersistence();
      expect(persistence).not.toBeNull();

      registry.replace([next.registration]);
      await old.waitForClose();
      expect(old.closeCount()).toBe(1);

      await expect(stale.close()).resolves.toBeUndefined();

      const replacement = registry.clients()[next.registration.id];
      expect(replacement).toBeDefined();
      const resumed = await replacement!.resumeSession(persistence!, {
        cwd: "/workspace",
      });

      await expect(
        resumed.startTurn("after reload", { clientMessageId: "after-reload" }),
      ).resolves.toEqual({ turnId: "turn-1" });

      expect(next.inputs).toContainEqual(
        expect.objectContaining({
          type: "session.open",
          history: "replay",
          persistence: {
            version: 1,
            data: { token: "root" },
          },
        }),
      );

      await resumed.close();
    } finally {
      await registry.shutdown();
    }
  });

  test("prompting a stale session raises StaleProviderSessionError", async () => {
    const old = createProviderHarness();
    const registry = new PluginAgentClientRegistry(createTestLogger());

    try {
      registry.replace([old.registration]);
      const stale = await registry.clients()[old.registration.id]!.createSession({
        provider: old.registration.id,
        cwd: "/workspace",
      });

      registry.replace([]);
      await old.waitForClose();
      expect(old.closeCount()).toBe(1);

      const failure = await stale
        .startTurn("after reload", { clientMessageId: "after-reload" })
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(failure).toBeInstanceOf(StaleProviderSessionError);
      expect(isStaleProviderSessionError(failure)).toBe(true);
      expect(isStaleProviderSessionError(new Error("Provider connection is closed"))).toBe(false);
      expect(isStaleProviderSessionError(new Error("boom"))).toBe(false);
    } finally {
      await registry.shutdown();
    }
  });

  test("a reused child publishes its second turn without changing parent or sibling lifecycle", async () => {
    const harness = createProviderHarness();
    const registry = new PluginAgentClientRegistry(createTestLogger());
    registry.replace([harness.registration]);
    try {
      const session = await registry.clients()[harness.registration.id]!.createSession({
        provider: harness.registration.id,
        cwd: "/workspace",
      });
      const subagents = new ProviderSubagentStore();
      const apply = (event: AgentStreamEvent) => {
        if (event.type === "provider_subagent") {
          subagents.apply("parent-agent", event.provider, event.event);
        }
      };
      for await (const event of session.streamHistory()) apply(event);
      expect(subagents.list("parent-agent")).toEqual([
        expect.objectContaining({ id: "child-1", title: "Plugin child", status: "completed" }),
      ]);
      // A sibling in the same store must remain untouched by the child's turn.
      subagents.apply("parent-agent", harness.registration.id, {
        type: "upsert",
        id: "sibling",
        title: "Sibling",
        status: "completed",
      });
      const live: AgentStreamEvent[] = [];
      const unsubscribe = session.subscribe((event) => {
        live.push(event);
        apply(event);
      });
      try {
        harness.emit({
          type: "session.turn",
          sessionId: "child-1",
          turnId: "child-turn-2",
          state: "started",
        });
        expect(
          subagents.list("parent-agent").find((child) => child.id === "child-1"),
        ).toMatchObject({
          title: "Plugin child",
          status: "running",
        });
        harness.emit({ type: "session.ready", sessionId: "child-1" });
        expect(subagents.list("parent-agent").find((child) => child.id === "child-1")?.status).toBe(
          "running",
        );
        harness.emit({
          type: "session.turn",
          sessionId: "child-1",
          turnId: "child-turn-2",
          state: "completed",
        });
        expect(subagents.list("parent-agent").find((child) => child.id === "child-1")?.status).toBe(
          "completed",
        );
        expect(
          subagents.list("parent-agent").find((child) => child.id === "sibling"),
        ).toMatchObject({
          title: "Sibling",
          status: "completed",
        });
        // These are child descriptor updates, never the managed parent's turn events.
        expect(live).toEqual([
          {
            type: "provider_subagent",
            provider: harness.registration.id,
            event: { type: "upsert", id: "child-1", status: "running" },
          },
          {
            type: "provider_subagent",
            provider: harness.registration.id,
            event: { type: "upsert", id: "child-1", status: "completed" },
          },
        ]);
      } finally {
        unsubscribe();
        await session.close();
      }
    } finally {
      await registry.shutdown();
    }
  });

  test("adapts callback providers into the existing AgentClient and AgentSession path", async () => {
    const harness = createProviderHarness();
    const registry = new PluginAgentClientRegistry(createTestLogger());
    registry.replace([harness.registration]);
    const client = registry.clients()[harness.registration.id];
    expect(client).toBeDefined();

    await expect(client!.fetchCatalog({ scope: "global", force: false })).resolves.toMatchObject({
      models: [
        {
          provider: "plugin-direct",
          id: "plugin-model",
          isDefault: true,
          thinkingOptions: [{ id: "deep", label: "Deep" }],
          defaultThinkingOptionId: "deep",
        },
      ],
      modes: [{ id: "build" }],
      defaultModeId: "build",
    });

    const session = await client!.createSession({ provider: "plugin-direct", cwd: "/workspace" });
    expect(session.features).toEqual([
      expect.objectContaining({
        type: "select",
        id: "voice",
        options: [{ id: "direct", label: "Direct", value: "direct" }],
      }),
    ]);
    expect(session.describePersistence()).toMatchObject({
      provider: "plugin-direct",
      metadata: { pluginProviderPersistence: { version: 1, data: { token: "root" } } },
    });

    const history: AgentStreamEvent[] = [];
    for await (const event of session.streamHistory()) history.push(event);
    expect(history).toContainEqual(
      expect.objectContaining({
        type: "provider_subagent",
        event: expect.objectContaining({ type: "timeline", id: "child-1" }),
      }),
    );
    expect(history).toContainEqual(
      expect.objectContaining({
        type: "provider_subagent",
        event: expect.objectContaining({ type: "upsert", id: "child-1", status: "completed" }),
      }),
    );

    const events: AgentStreamEvent[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event));
    await expect(
      session.startTurn("hello", { clientMessageId: "client-message" }),
    ).resolves.toEqual({ turnId: "turn-1" });
    expect(
      events
        .filter((event) => event.type === "timeline")
        .map((event) => (event.type === "timeline" ? event.item : null)),
    ).toEqual([
      { type: "assistant_message", text: "Hel", messageId: "answer" },
      { type: "assistant_message", text: "lo", messageId: "answer" },
    ]);
    expect(session.getPendingPermissions()).toEqual([
      expect.objectContaining({ id: "permission-1", provider: "plugin-direct" }),
    ]);

    await session.respondToPermission("permission-1", { behavior: "allow" });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "permission_resolved",
        requestId: "permission-1",
        resolution: { behavior: "allow" },
      }),
    );
    await session.setModel?.("plugin-model");
    expect(await session.getRuntimeInfo()).toMatchObject({
      model: "plugin-model",
      modeId: "build",
    });

    unsubscribe();
    await session.close();
    registry.replace([]);
    await expect.poll(harness.closeCount).toBe(1);
    expect(harness.inputs.map((input) => input.type)).toContain("session.close");
  });
});
