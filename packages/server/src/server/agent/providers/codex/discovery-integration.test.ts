import { afterEach, describe, expect, it, vi } from "vitest";
import pino from "pino";
import { spawnProcess } from "../../../../utils/spawn.js";
import { buildProviderRegistry } from "../../provider-registry.js";
import { CodexAppServerAgentClient } from "../codex-app-server-agent.js";
import { createFakeCodexAppServer } from "./test-utils/fake-app-server.js";

vi.mock("../../../../utils/spawn.js", async (original) => ({
  ...(await original<typeof import("../../../../utils/spawn.js")>()),
  spawnProcess: vi.fn(),
}));
vi.mock("../../../../executable-resolution/executable-resolution.js", async (original) => ({
  ...(await original<
    typeof import("../../../../executable-resolution/executable-resolution.js")
  >()),
  findExecutable: vi.fn(async () => "/configured/codex.CMD"),
}));
const threadId = "01a14152-e1ac-72f4-9565-0978e4520014";
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
describe("configured Codex discovery integration", () => {
  it("uses the configured launch/env and quiet transport, never starting or resuming a thread", async () => {
    vi.stubEnv("CODEX_HOME", "/inherited/home");
    const secret = "SECRET_ARGUMENT_CONFIG_STDERR_PREVIEW";
    const fake = createFakeCodexAppServer({
      initialize: () => ({ userAgent: "codex_cli_rs/0.162.1", codexHome: "/actual/home" }),
      "config/read": () => ({ config: { model_provider: "configured-backend", secret } }),
      "thread/read": () => {
        fake.child.stdout.write(`${secret}\n`);
        fake.child.stderr.write(secret);
        return {
          thread: {
            id: threadId,
            name: "CI Proofing",
            source: "appServer",
            turns: [secret],
            preview: secret,
          },
        };
      },
      "thread/list": () => ({ data: [], nextCursor: null }),
    });
    vi.mocked(spawnProcess).mockReturnValue(fake.child);
    const logged: string[] = [];
    const logger = pino(
      { level: "trace" },
      {
        write: (line) => {
          logged.push(line);
        },
      },
    );
    const registry = buildProviderRegistry(logger, {
      providerOverrides: {
        "my-codex": {
          extends: "codex",
          label: "My Codex",
          command: ["configured-wrapper", "--private", secret],
          env: { CODEX_HOME: "/configured/home", SECRET_SETTING: secret },
        },
      },
    });
    const provider = registry["my-codex"]!.createClient(logger);
    expect(provider.provider).toBe("my-codex");
    const result = await provider.diagnoseDiscovery!(
      { threadId },
      { knownImportedSessionCount: 0, isImported: () => false },
    );
    expect(spawnProcess).toHaveBeenCalledOnce();
    expect(spawnProcess).toHaveBeenCalledWith(
      "configured-wrapper",
      ["--private", secret, "app-server"],
      expect.objectContaining({
        envOverlay: expect.objectContaining({ CODEX_HOME: "/configured/home" }),
      }),
    );
    expect(result.runtime).toMatchObject({
      resolvedExecutable: "/configured/codex.CMD",
      version: "0.162.1",
      launchHome: "/configured/home",
      reportedHome: "/actual/home",
      configuredModelProvider: "configured-backend",
    });
    expect(fake.requests().map((r) => r.method)).toEqual([
      "initialize",
      "initialized",
      "config/read",
      "thread/read",
      "thread/list",
    ]);
    expect(fake.requests().find((r) => r.method === "thread/read")?.params).toEqual({
      threadId,
      includeTurns: false,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(logged).toEqual([]);
    fake.assertNoErrors();
  });
  it("preserves ordinary import listing requests and preview/title output", async () => {
    const fake = createFakeCodexAppServer({
      "thread/list": () => ({
        data: [
          {
            id: threadId,
            cwd: "/same-directory",
            name: "Existing name",
            preview: "Existing preview",
            createdAt: 1000,
            updatedAt: 2000,
          },
        ],
        nextCursor: "ignored-by-normal-list",
      }),
    });
    vi.mocked(spawnProcess).mockReturnValue(fake.child);
    const provider = new CodexAppServerAgentClient(pino({ level: "silent" }));
    expect(await provider.listImportableSessions()).toEqual([
      {
        providerHandleId: threadId,
        cwd: "/same-directory",
        title: "Existing name",
        firstPromptPreview: "Existing preview",
        lastPromptPreview: "Existing preview",
        lastActivityAt: new Date(2000 * 1000),
      },
    ]);
    expect(
      fake
        .requests()
        .filter((r) => r.method === "thread/list")
        .map((r) => r.params),
    ).toEqual([{ limit: 20 }]);
    expect(fake.requests().some((r) => r.method === "thread/read")).toBe(false);
    fake.assertNoErrors();
  });
});
