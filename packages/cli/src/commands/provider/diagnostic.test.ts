import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { connectToDaemon } from "../../utils/client.js";
import { runDiagnosticCommand } from "./diagnostic.js";
import { renderJson } from "../../output/json.js";

vi.mock("../../utils/client.js", () => ({ connectToDaemon: vi.fn() }));
const getProviderDiagnostic = vi.fn();
const close = vi.fn();
const thread = "01a14152-e1ac-72f4-9565-0978e4520014";
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(connectToDaemon).mockResolvedValue({
    getProviderDiagnostic,
    close,
  } as unknown as Awaited<ReturnType<typeof connectToDaemon>>);
  getProviderDiagnostic.mockResolvedValue({ provider: "codex", diagnostic: "existing diagnostic" });
});
describe("provider diagnostic CLI", () => {
  it("renders the successful diagnostic sidecar in actual single-object JSON output", async () => {
    const discovery = {
      runtime: {
        resolvedExecutable: "/codex",
        version: "0.162.1",
        reportedHome: null,
        launchHome: null,
        homeVerification: "unverified",
        configuredModelProvider: null,
        storageBackend: null,
      },
      target: { requestedId: thread, readAttempted: true, status: "not_found" },
      listing: { status: "ok", rawCount: 0, cursorPresent: true, nextCursor: null },
      knownImportedSessionCount: 16,
      request: { threadId: thread },
    };
    getProviderDiagnostic.mockResolvedValue({ provider: "codex", diagnostic: "", discovery });
    const result = await runDiagnosticCommand("codex", { thread }, new Command());
    const json = renderJson(result, {
      format: "json",
      quiet: false,
      noHeaders: false,
      noColor: true,
    });
    expect(JSON.parse(json)).toEqual({ provider: "codex", diagnostic: "", discovery });
    expect(close).toHaveBeenCalledOnce();
  });
  it("preserves the default single-result JSON fields", async () => {
    const result = await runDiagnosticCommand("Codex", {}, new Command());
    expect(result.data).toEqual({ provider: "codex", diagnostic: "existing diagnostic" });
    expect(getProviderDiagnostic).toHaveBeenCalledWith("codex", undefined);
    expect(close).toHaveBeenCalledOnce();
  });
  it.each([
    { limit: "5" },
    { compareSource: "appServer" },
    { thread: "bad" },
    { thread, limit: "NaN" },
    { thread, limit: "101" },
    { thread, compareSource: "all" },
  ])("rejects invalid options before connecting", async (options) => {
    await expect(runDiagnosticCommand("codex", options, new Command())).rejects.toThrow();
    expect(connectToDaemon).not.toHaveBeenCalled();
  });
  it("does not accept a missing diagnostic sidecar or retry with defaults", async () => {
    await expect(
      runDiagnosticCommand(
        "codex",
        { thread, limit: "30", compareSource: "appServer" },
        new Command(),
      ),
    ).rejects.toThrow("Host did not return");
    expect(getProviderDiagnostic).toHaveBeenCalledOnce();
    expect(getProviderDiagnostic).toHaveBeenCalledWith("codex", {
      discovery: { threadId: thread, limit: 30, compareSource: "appServer" },
    });
    expect(close).toHaveBeenCalledOnce();
  });
});
