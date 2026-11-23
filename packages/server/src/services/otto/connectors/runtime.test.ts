import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTool } from "@getpaseo/plugin/server/otto-openai";
import type { ConnectorTransport } from "@getpaseo/plugin/otto/connectors";
import {
  ConnectorRuntime,
  connectorToolFingerprint,
  type ConnectorRuntimePorts,
} from "./runtime.js";
import { connectorServerSummary } from "./configuration.js";
import type { ConnectorEntry } from "./store.js";

const pools: ConnectorRuntime[] = [];
afterEach(async () => {
  for (const pool of pools.splice(0)) await pool.close();
  vi.useRealTimers();
});
function deferred() {
  let done: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    done = resolve;
  });
  return {
    promise,
    resolve() {
      done();
    },
  };
}
function fixture(kind: "http" | "stdio" = "http") {
  const secret = 'private"fixture-key';
  const server: ConnectorTransport =
    kind === "http"
      ? {
          type: "http",
          url: "https://fixture.invalid/mcp",
          headers: { Authorization: `Bearer ${secret}` },
        }
      : { type: "stdio", command: "fixture-server", args: [], env: { KEY: secret } };
  const entry: ConnectorEntry = {
    id: "fixture",
    label: "Fixture",
    generation: "generation",
    fingerprint: "config",
    catalogId: null,
    enabled: true,
    disabledTools: [],
    server: connectorServerSummary(server),
    authorization: { state: "not-required", account: null, scopes: [], message: null },
    verification: {
      state: "verified",
      checkedAt: null,
      fingerprint: null,
      message: null,
      tools: [],
    },
  };
  let loads = 0;
  let closes = 0;
  let executions = 0;
  let execute: AgentTool["execute"] = async () => `Value: ${secret}`;
  let beforeLoad: (() => Promise<void>) | null = null;
  const original: AgentTool = {
    access: "read",
    preapproval: { server: "connector", tool: "read" },
    definition: {
      type: "function",
      function: {
        name: "opaque-inner-name",
        description: `Read data ${secret}`,
        parameters: { type: "object", properties: { query: { type: "string" } } },
      },
    },
    detail: () => ({ type: "unknown", input: {}, output: null }),
    execute: async (input, signal) => {
      executions++;
      return execute(input, signal);
    },
  };
  let tools = [original];
  const contexts: string[] = [];
  let grantRevision = "grant-one";
  const ports: ConnectorRuntimePorts = {
    store: {
      open: async () => ({
        revision: "settings",
        entry: structuredClone(entry),
        bundle: { server, oauth: false, scope: "" },
      }),
    },
    authorize: async () => ({ server, revision: grantRevision }),
    load: async (_config, _timeout, _signal, context) => {
      loads++;
      contexts.push(context.cwd);
      await beforeLoad?.();
      return {
        tools,
        instructions: [],
        close: async () => {
          closes++;
        },
      };
    },
  };
  const runtime = new ConnectorRuntime(ports);
  pools.push(runtime);
  return {
    runtime,
    entry,
    secret,
    contexts,
    original,
    loads: () => loads,
    closes: () => closes,
    executions: () => executions,
    execute(value: AgentTool["execute"]) {
      execute = value;
    },
    tools(value: AgentTool[]) {
      tools = value;
    },
    beforeLoad(value: () => Promise<void>) {
      beforeLoad = value;
    },
    rotateGrant() {
      grantRevision = "grant-two";
    },
  };
}
async function call(host: ReturnType<typeof fixture>, name = "read") {
  const tools = await host.runtime.inspect("fixture", "workspace", new AbortController().signal);
  const tool = tools.find((value) => value.name === name)!;
  return host.runtime.call({
    id: "fixture",
    cwd: "workspace",
    name,
    arguments: { query: "test" },
    schemaFingerprint: connectorToolFingerprint(tool),
  });
}

describe("provider-neutral host Connector clients", () => {
  it("is inert on construction, reuses one HTTP client and redacts credentials before returning metadata/results", async () => {
    const host = fixture();
    expect(host.loads()).toBe(0);
    const tools = await host.runtime.inspect(
      "fixture",
      "first-workspace",
      new AbortController().signal,
    );
    expect(tools[0].description).toBe("Read data [redacted]");
    expect((await call(host)).content).toEqual([{ type: "text", text: "Value: [redacted]" }]);
    expect(host.loads()).toBe(1);
    expect(host.executions()).toBe(1);
  });

  it.each(["connector", "tool"])(
    "enforces a live disabled %s after its tools have been advertised",
    async (scope) => {
      const host = fixture();
      const [tool] = await host.runtime.inspect(
        "fixture",
        "workspace",
        new AbortController().signal,
      );
      if (scope === "connector") host.entry.enabled = false;
      else host.entry.disabledTools = ["read"];
      await expect(
        host.runtime.call({
          id: "fixture",
          cwd: "workspace",
          name: "read",
          arguments: {},
          schemaFingerprint: connectorToolFingerprint(tool),
        }),
      ).rejects.toMatchObject({ kind: "unavailable" });
      expect(host.executions()).toBe(0);
    },
  );

  it("rechecks enablement after a queued operation, without overlapping calls or replaying the first", async () => {
    const host = fixture();
    const entered = deferred();
    const release = deferred();
    host.execute(async () => {
      entered.resolve();
      await release.promise;
      return "accepted";
    });
    const [tool] = await host.runtime.inspect("fixture", "workspace", new AbortController().signal);
    const input = {
      id: "fixture",
      cwd: "workspace",
      name: "read",
      arguments: {},
      schemaFingerprint: connectorToolFingerprint(tool),
    };
    const first = host.runtime.call(input);
    await entered.promise;
    const second = host.runtime.call(input);
    const rejected = expect(second).rejects.toMatchObject({ kind: "unavailable" });
    host.entry.enabled = false;
    release.resolve();
    await first;
    await rejected;
    expect(host.executions()).toBe(1);
  });

  it("keeps stdio working directories isolated", async () => {
    const host = fixture("stdio");
    await host.runtime.inspect("fixture", "first-workspace", new AbortController().signal);
    await host.runtime.inspect("fixture", "second-workspace", new AbortController().signal);
    expect(host.contexts).toEqual(["first-workspace", "second-workspace"]);
    expect(host.loads()).toBe(2);
  });

  it("retires idle clients and refuses an old schema after reconnecting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const host = fixture();
    const [old] = await host.runtime.inspect("fixture", "workspace", new AbortController().signal);
    await vi.advanceTimersByTimeAsync(360000);
    expect(host.closes()).toBe(1);
    host.tools([
      {
        ...host.original,
        definition: {
          ...host.original.definition,
          function: {
            ...host.original.definition.function,
            parameters: { type: "object", properties: { changed: { type: "number" } } },
          },
        },
      },
    ]);
    await expect(
      host.runtime.call({
        id: "fixture",
        cwd: "workspace",
        name: "read",
        arguments: {},
        schemaFingerprint: connectorToolFingerprint(old),
      }),
    ).rejects.toMatchObject({ kind: "conflict" });
    expect(host.executions()).toBe(0);
  });

  it.each(["empty", "duplicate", "secret-schema"])(
    "does not admit an invalid %s catalog and releases its client",
    async (condition) => {
      const host = fixture();
      if (condition === "empty") host.tools([]);
      else if (condition === "duplicate") host.tools([host.original, host.original]);
      else
        host.tools([
          {
            ...host.original,
            definition: {
              ...host.original.definition,
              function: {
                ...host.original.definition.function,
                parameters: { type: "object", properties: { token: { const: host.secret } } },
              },
            },
          },
        ]);
      await expect(
        host.runtime.inspect("fixture", "workspace", new AbortController().signal),
      ).rejects.toMatchObject({ kind: "vendor" });
      expect(host.closes()).toBe(1);
    },
  );

  it("uses the new grant generation on the next call without replaying an old operation", async () => {
    const host = fixture();
    await call(host);
    host.rotateGrant();
    await call(host);
    expect(host.loads()).toBe(2);
    expect(host.closes()).toBe(1);
    expect(host.executions()).toBe(2);
  });

  it("labels uncertain write outcomes and redacts error details without automatic replay", async () => {
    const host = fixture();
    host.original.access = "unknown";
    host.execute(async () => {
      throw new Error(`Network failed ${host.secret}`);
    });
    await expect(call(host)).rejects.toMatchObject({
      kind: "vendor",
      message:
        "Network failed [redacted] The operation may have succeeded. Verify its result before repeating it.",
    });
    expect(host.executions()).toBe(1);
  });

  it("does not initialize a transport for an already aborted demand", async () => {
    const host = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      host.runtime.inspect("fixture", "workspace", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(host.loads()).toBe(0);
  });

  it("does not adopt a connection that finishes after shutdown", async () => {
    const host = fixture();
    const entered = deferred();
    const release = deferred();
    host.beforeLoad(async () => {
      entered.resolve();
      await release.promise;
    });
    const connection = host.runtime.inspect("fixture", "workspace", new AbortController().signal);
    await entered.promise;
    const rejected = expect(connection).rejects.toMatchObject({ kind: "conflict" });
    const closing = host.runtime.close();
    release.resolve();
    await rejected;
    await closing;
    expect(host.closes()).toBe(1);
  });
});
