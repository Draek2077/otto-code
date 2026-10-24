import { afterEach, describe, expect, it, vi } from "vitest";
const transport = vi.hoisted(() => ({ connect: vi.fn(), invoke: vi.fn(), close: vi.fn() }));
vi.mock("../../utils/client.js", () => ({ connectToDaemon: transport.connect }));
import { Command } from "commander";
import { createOttoBrainCommand } from "./commands.js";

function cli() {
  return new Command("otto")
    .option("--host <host>")
    .option("--home <home>")
    .option("--json")
    .addCommand(createOttoBrainCommand());
}
afterEach(() => vi.restoreAllMocks());
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
});
