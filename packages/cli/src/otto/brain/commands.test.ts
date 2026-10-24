import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const transport = vi.hoisted(() => ({ connect: vi.fn(), invoke: vi.fn(), close: vi.fn() }));
vi.mock("../../utils/client.js", () => ({ connectToDaemon: transport.connect }));
import { Command } from "commander";
import { createOttoBrainCommand } from "./commands.js";
import { BrainStatusSchema } from "@getpaseo/protocol/otto/brain";

function cli() {
  return new Command("otto")
    .option("--host <host>")
    .option("--home <home>")
    .option("--json")
    .option("--format <format>", "Output format", "cli")
    .addCommand(createOttoBrainCommand());
}
function feedGate() {
  let finish!: (value: unknown) => void;
  const promise = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  return { promise, finish: (value: unknown) => finish(value) };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  transport.connect.mockReset();
  transport.invoke.mockReset();
  transport.close.mockReset();
});
describe("Brain CLI command composition", () => {
  it("constructs the complete management tree and help without connecting or resolving an owner", () => {
    const brain = createOttoBrainCommand();
    expect(brain.helpInformation()).toContain("Remote Brain");
    expect(brain.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining([
        "status",
        "start",
        "stop",
        "restart",
        "model",
        "runtime",
        "connection",
        "owner",
        "catalog",
        "search",
        "quants",
        "pull",
        "add",
        "calibrate",
        "sweep",
        "benchmark",
        "job",
        "evals",
      ]),
    );
    expect(transport.connect).not.toHaveBeenCalled();
  });
  it("keeps --host/output selection for a nested model operation and leaves its durable work running", async () => {
    transport.connect.mockResolvedValue({
      getLastServerInfoMessage: () => ({ features: { ottoBrain: true } }),
      invokePluginRpc: transport.invoke.mockResolvedValue({ ok: true, value: { accepted: true } }),
      close: transport.close.mockResolvedValue(undefined),
    });
    const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await cli().parseAsync(
      ["brain", "model", "load", "host-issued/model", "--host", "selected.example:6788", "--json"],
      { from: "user" },
    );
    expect(transport.connect).toHaveBeenCalledExactlyOnceWith({
      target: { kind: "endpoint", host: "selected.example:6788" },
    });
    expect(transport.invoke).toHaveBeenCalledExactlyOnceWith("otto-brain", "brain.action", {
      action: "load",
      modelId: "host-issued/model",
    });
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"accepted": true'));
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it("runs shared catalog, report and replay handlers on the selected Remote owner", async () => {
    const clientHome = fileURLToPath(
      new URL(`../../../../../.tmp/brain-cli-client-${randomUUID()}`, import.meta.url),
    );
    vi.stubEnv("OTTO_HOME", clientHome);
    const status = {
      instanceId: "selected-owner",
      running: true,
      reachable: true,
      state: "stopped",
      version: "fixture",
      model: null,
      modelId: null,
      queued: 0,
      libraryRevision: 0,
      jobRevision: 0,
      ownerSettingsRevision: null,
      telemetry: { requests: 0, ok: 0, reasoningOnly: 0, truncated: 0, warning: null },
      jobs: [],
      residents: [],
      scheduler: { waitingModelIds: {} },
      capabilities: Object.fromEntries(
        Object.keys(BrainStatusSchema.shape.capabilities.shape).map((key) => [
          key,
          key === "apiVersion" ? 3 : true,
        ]),
      ),
    };
    const feed = feedGate();
    transport.invoke.mockImplementation(async (_plugin: string, method: string, input: unknown) => {
      if (method === "brain.status.wait") return feed.promise;
      if (method === "brain.status.release") {
        feed.finish({
          ok: true,
          value: {
            controlRevision: "selected-revision",
            cursor: "released",
            connection: "connecting",
            status: null,
            logs: [],
            firstLogIndex: 0,
            nextLogIndex: 0,
            error: null,
          },
        });
        return { ok: true, value: { released: true } };
      }
      if (method === "brain.bootstrap")
        return {
          ok: true,
          value: {
            connection: {
              version: 1,
              revision: "selected-revision",
              config: {
                enabled: true,
                autoStart: false,
                mode: "remote",
                remote: { host: "owner.invalid", port: 1234, secure: false, certFingerprint: null },
              },
              credential: { stored: false, effectiveSource: "none" },
            },
            owner: null,
            ownerError: null,
            localRunning: false,
            endpoint: "http://owner.invalid:1234",
          },
        };
      if (method === "brain.query") return { ok: true, value: status };
      if (
        method !== "brain.cli.request" ||
        !input ||
        typeof input !== "object" ||
        !("request" in input)
      )
        throw new Error("Unexpected test request");
      const request = input.request;
      if (!request || typeof request !== "object" || !("operation" in request))
        throw new Error("Missing operation");
      if (request.operation === "capabilities")
        return {
          ok: true,
          value: {
            modelAcquisition: true,
            catalog: true,
            hfSearch: true,
            inventory: true,
            jobs: true,
            events: true,
            reports: true,
            rescore: true,
          },
        };
      if (request.operation === "inventory") return { ok: true, value: { models: [] } };
      if (request.operation === "catalog")
        return {
          ok: true,
          value: {
            models: [
              {
                id: "catalog/stable",
                name: "Owner model",
                hfRepo: "owner/model",
                quant: "Q8_0",
                favorite: true,
              },
            ],
          },
        };
      if (request.operation === "report-export")
        return {
          ok: true,
          value: {
            ok: true,
            report: {
              file: "owner-issued-report.html",
              count: 1,
              columns: [{ id: "task", category: "tools" }],
              models: [
                {
                  id: "host/model",
                  displayName: "Owner model",
                  overall: 0.5,
                  tasks: [{ id: "task", category: "tools", score: 0.5 }],
                },
              ],
            },
          },
        };
      if (request.operation === "rescore")
        return { ok: true, value: { ok: true, job: { id: "rescore-job" } } };
      if (request.operation === "job-read")
        return {
          ok: true,
          value: {
            job: {
              id: "rescore-job",
              state: "completed",
              progress: null,
              error: null,
              result: [
                {
                  archiveId: "owner-run",
                  changed: 1,
                  tasks: [
                    {
                      taskId: "tools",
                      before: 0.5,
                      score: 1,
                      changed: true,
                      summary: "Stored exchange verified",
                    },
                  ],
                },
              ],
            },
          },
        };
      throw new Error("Unexpected test command");
    });
    transport.connect.mockResolvedValue({
      getLastServerInfoMessage: () => ({ features: { ottoBrain: true, ottoBrainCommands: true } }),
      invokePluginRpc: transport.invoke,
      close: transport.close.mockResolvedValue(undefined),
    });
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    await cli().parseAsync(
      ["brain", "catalog", "--host", "selected.example:6788", "--format", "yaml"],
      { from: "user" },
    );
    expect(lines.join("")).toContain("repo: owner/model");
    expect(lines.join("")).toContain("name: Owner model");
    expect(transport.connect).toHaveBeenCalledExactlyOnceWith({
      target: { kind: "endpoint", host: "selected.example:6788" },
    });
    expect(transport.invoke).toHaveBeenCalledWith(
      "otto-brain",
      "brain.cli.request",
      expect.objectContaining({
        connectionRevision: "selected-revision",
        instanceId: "selected-owner",
        requestId: expect.any(String),
        request: { operation: "catalog" },
      }),
    );
    expect(transport.close).toHaveBeenCalledOnce();
    lines.length = 0;
    await cli().parseAsync(
      [
        "brain",
        "report",
        "--host",
        "selected.example:6788",
        "--quiet",
        "--out",
        "owner-report.html",
      ],
      { from: "user" },
    );
    expect(lines.join("")).toBe("owner-issued-report.html\n");
    expect(transport.invoke).toHaveBeenCalledWith(
      "otto-brain",
      "brain.cli.request",
      expect.objectContaining({
        request: { operation: "report-export", body: { out: "owner-report.html" } },
      }),
    );
    expect(transport.close).toHaveBeenCalledTimes(2);
    lines.length = 0;
    await cli().parseAsync(
      [
        "brain",
        "rescore",
        "--host",
        "selected.example:6788",
        "--quiet",
        "--run",
        "owner-run",
        "--no-execute",
      ],
      { from: "user" },
    );
    expect(lines.join("")).toBe("owner-run\n");
    expect(transport.invoke).toHaveBeenCalledWith(
      "otto-brain",
      "brain.cli.request",
      expect.objectContaining({
        request: { operation: "rescore", body: { run: "owner-run", execute: false } },
      }),
    );
    expect(
      transport.invoke.mock.calls.filter((call) => call[1] === "brain.status.release"),
    ).toHaveLength(1);
    expect(transport.close).toHaveBeenCalledTimes(3);
    expect(existsSync(clientHome)).toBe(false);
  });
});
