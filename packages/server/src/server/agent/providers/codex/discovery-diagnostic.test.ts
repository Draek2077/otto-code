import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { diagnoseCodexDiscovery } from "./discovery-diagnostic.js";
import { CodexAppServerClient, CodexAppServerRpcError } from "./app-server-transport.js";
import { createFakeCodexAppServer } from "./test-utils/fake-app-server.js";

const id = "01a14152-e1ac-72f4-9565-0978e4520014";
const secret = "SECRET_PREVIEW_TURNS_CONFIG_STDERR";
const imports = {
  knownImportedSessionCount: 16,
  isImported: (value: string) => value.startsWith("imported-"),
};
function setup(handlers: Record<string, (params: unknown) => unknown> = {}) {
  const fake = createFakeCodexAppServer({
    initialize: () => ({
      userAgent: "codex_cli_rs/0.162.1 (private machine)",
      codexHome: "/effective/home",
      secret,
    }),
    "config/read": () => ({
      config: { model_provider: "openai", secret, model_providers: { secret } },
    }),
    "thread/read": () => ({
      thread: {
        id,
        name: "CI Proofing",
        cwd: "/shared",
        source: "appServer",
        modelProvider: "openai",
        projectId: "project-1",
        sectionId: "section-1",
        preview: secret,
        turns: [secret],
      },
    }),
    "thread/list": () => ({
      data: [
        ...Array.from({ length: 16 }, (_, i) => ({ id: `imported-${i}`, preview: secret })),
        {
          id: "metadata",
          preview: "Generate metadata for a coding agent based on the user prompt. private",
        },
        { id: "old", name: "UNRELATED_TITLE", preview: secret },
      ],
      nextCursor: "actual-cursor",
    }),
    ...handlers,
  });
  const client = new CodexAppServerClient(fake.child, pino({ level: "silent" }));
  const dispose = vi.spyOn(client, "dispose");
  const run = (options = {}) =>
    diagnoseCodexDiscovery(
      { threadId: id, ...options },
      {
        open: async () => ({
          client,
          runtime: { resolvedExecutable: "/configured/codex", launchHome: "/launch/home" },
        }),
        initializeParams: { clientInfo: { name: "otto" } },
        imports,
      },
    );
  return { fake, client, dispose, run };
}

describe("bounded Codex discovery metadata", () => {
  it("reads only summary metadata, preserves raw count/cursor, and counts Otto exclusions", async () => {
    const { fake, dispose, run } = setup();
    const result = await run();
    expect(result.target).toEqual({
      requestedId: id,
      readAttempted: true,
      status: "found",
      nativeId: id,
      title: "CI Proofing",
      cwd: "/shared",
      source: "appServer",
      modelProvider: "openai",
      project: "project-1",
      section: "section-1",
    });
    expect(result.runtime).toEqual({
      resolvedExecutable: "/configured/codex",
      version: "0.162.1",
      launchHome: "/launch/home",
      reportedHome: "/effective/home",
      homeVerification: "runtime",
      configuredModelProvider: "openai",
      storageBackend: null,
    });
    expect(result.listing).toEqual({
      status: "ok",
      rawCount: 18,
      cursorPresent: true,
      nextCursor: "actual-cursor",
      targetPresent: false,
      excluded: { invalidMetadata: 0, cwd: 0, metadataGeneration: 1, alreadyImported: 16 },
      eligibleCount: 1,
    });
    expect(fake.requests().map((r) => r.method)).toEqual([
      "initialize",
      "initialized",
      "config/read",
      "thread/read",
      "thread/list",
    ]);
    expect(fake.requests().find((r) => r.method === "thread/read")?.params).toEqual({
      threadId: id,
      includeTurns: false,
    });
    expect(fake.requests().find((r) => r.method === "thread/list")?.params).toEqual({
      limit: 20,
      archived: false,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("UNRELATED_TITLE");
    expect(dispose).toHaveBeenCalledOnce();
    fake.assertNoErrors();
  });
  it.each([undefined, null, "next-page"])(
    "preserves cursor presence and value: %s",
    async (cursor) => {
      const { run } = setup({
        "thread/list": () => ({
          data: [],
          ...(cursor !== undefined ? { nextCursor: cursor } : {}),
        }),
      });
      const result = await run();
      expect(result.listing.cursorPresent).toBe(cursor !== undefined);
      expect(Object.hasOwn(result.listing, "nextCursor")).toBe(cursor !== undefined);
      expect(result.listing.nextCursor).toBe(cursor);
    },
  );
  it("compares sources only when explicitly requested, without broadening archive/model defaults", async () => {
    const { run, fake } = setup();
    await run({ compareSource: "appServer", cwd: "/shared", limit: 40, cursor: "supplied" });
    expect(
      fake
        .requests()
        .filter((r) => r.method === "thread/list")
        .map((r) => r.params),
    ).toEqual([
      { limit: 40, archived: false, cwd: "/shared", cursor: "supplied" },
      { limit: 40, archived: false, cwd: "/shared", sourceKinds: ["appServer"] },
    ]);
  });
  it("does not invent default home, version, source, project, or backend", async () => {
    const { run } = setup({
      initialize: () => ({}),
      "config/read": () => ({}),
      "thread/read": () => ({ thread: { id, preview: secret, source: { secret } } }),
    });
    const result = await run();
    expect(result.runtime).toMatchObject({
      version: null,
      reportedHome: null,
      homeVerification: "launch_environment_only",
      configuredModelProvider: null,
      storageBackend: null,
    });
    expect(result.target).toMatchObject({
      title: null,
      source: null,
      project: null,
      section: null,
    });
  });
  it.each([
    [
      new CodexAppServerRpcError(`no rollout found for thread id ${id}`, -32600, secret),
      "not_found",
      undefined,
    ],
    [new Error(`Access is denied ${secret}`), "error", "permission_denied"],
    [new Error(`invalid params ${secret}`), "error", "provider_error"],
  ])("distinguishes absence from provider/access errors", async (error, status, code) => {
    const client = {
      request: vi.fn(async (method: string) => {
        if (method === "thread/read") throw error;
        return method === "thread/list" ? { data: [] } : {};
      }),
      notify: vi.fn(),
      dispose: vi.fn(async () => {}),
    };
    const result = await diagnoseCodexDiscovery(
      { threadId: id },
      {
        open: async () => ({ client, runtime: { resolvedExecutable: "codex", launchHome: null } }),
        initializeParams: {},
        imports,
      },
    );
    expect(result.target.status).toBe(status);
    expect(result.target.error).toBe(code);
    expect(result.listing.status).toBe("ok");
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("reports startup access denial without claiming a rejected metadata lookup", async () => {
    const result = await diagnoseCodexDiscovery(
      { threadId: id },
      {
        open: async () => {
          throw new Error(`Access is denied ${secret}`);
        },
        initializeParams: {},
        imports,
      },
    );
    expect(result.target).toEqual({
      requestedId: id,
      readAttempted: false,
      status: "error",
      error: "permission_denied",
      errorStage: "startup",
    });
    expect(result.listing).toEqual({ status: "error", error: "permission_denied" });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("rejects a different native ID and malformed listing instead of reporting absence or zero rows", async () => {
    const { run } = setup({
      "thread/read": () => ({ thread: { id: "different", name: secret } }),
      "thread/list": () => ({ data: [], nextCursor: { secret } }),
    });
    const result = await run();
    expect(result.target).toMatchObject({
      status: "error",
      readAttempted: true,
      error: "invalid_response",
    });
    expect(result.listing).toEqual({ status: "error", error: "invalid_response" });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("counts cwd and malformed metadata before imported/metadata exclusions on the same raw page", async () => {
    const { run } = setup({
      "thread/list": () => ({
        data: [
          null,
          { id: "imported-elsewhere", cwd: "/other" },
          {
            id: "imported-metadata",
            cwd: "/shared",
            preview: " Generate metadata for a coding agent based on the user prompt. private",
          },
          { id: "imported-1", cwd: "/shared" },
          { id, cwd: "/shared" },
        ],
      }),
    });
    const result = await run({ cwd: "/shared" });
    expect(result.listing).toMatchObject({
      rawCount: 5,
      targetPresent: true,
      excluded: { invalidMetadata: 1, cwd: 1, metadataGeneration: 1, alreadyImported: 1 },
      eligibleCount: 1,
    });
  });
  it("disposes a helper that finishes opening after the budget expires", async () => {
    const client = {
      request: vi.fn(async () => ({})),
      notify: vi.fn(),
      dispose: vi.fn(async () => {}),
    };
    let opened: (value: {
      client: typeof client;
      runtime: { resolvedExecutable: string; launchHome: null };
    }) => void = () => {};
    const pending = new Promise<{
      client: typeof client;
      runtime: { resolvedExecutable: string; launchHome: null };
    }>((resolve) => {
      opened = resolve;
    });
    const result = await diagnoseCodexDiscovery(
      { threadId: id },
      { open: () => pending, initializeParams: {}, imports, timeoutMs: 10 },
    );
    expect(result.target).toMatchObject({ error: "timeout", readAttempted: false });
    opened({ client, runtime: { resolvedExecutable: "codex", launchHome: null } });
    await vi.waitFor(() => expect(client.dispose).toHaveBeenCalledOnce());
    expect(client.request).not.toHaveBeenCalled();
  });
  it("times out and disposes the helper without issuing subsequent RPCs", async () => {
    const client = {
      request: vi.fn(() => new Promise<unknown>(() => {})),
      notify: vi.fn(),
      dispose: vi.fn(async () => {}),
    };
    const result = await diagnoseCodexDiscovery(
      { threadId: id },
      {
        open: async () => ({ client, runtime: { resolvedExecutable: "codex", launchHome: null } }),
        initializeParams: {},
        imports,
        timeoutMs: 10,
      },
    );
    expect(result.target.error).toBe("timeout");
    expect(client.request).toHaveBeenCalledOnce();
    expect(client.dispose).toHaveBeenCalledOnce();
  });
});
