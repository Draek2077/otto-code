import { afterEach, expect, it, vi } from "vitest";
import path from "node:path";
import { Command } from "commander";
import { selectedBrainLocalEnvironment } from "@getpaseo/brain/cli-target";
const transport = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("../../utils/client.js", () => ({ connectToDaemon: transport.connect }));
import { createOttoBrainCommand } from "./commands.js";
import { executeBrainCommand } from "./shared.js";

afterEach(() => {
  vi.restoreAllMocks();
  transport.connect.mockReset();
});
function cli(effect: () => Promise<void>) {
  const brain = createOttoBrainCommand();
  const serve = brain.commands.find((entry) => entry.name() === "serve");
  if (!serve) throw new Error("Foreground Brain is not registered");
  // Inject only the effect. The actual registered command retains its local-only selector policy.
  serve.action(function (this: Command) {
    return executeBrainCommand(this, effect);
  });
  return new Command("otto").option("--host <host>").option("--home <path>").addCommand(brain);
}
it("captures an explicit local home without connecting to Otto or changing ambient environment", async () => {
  const home = path.resolve(".tmp/foreground-command-fixture");
  const original = { OTTO_HOME: process.env.OTTO_HOME, PASEO_HOME: process.env.PASEO_HOME };
  const effect = vi.fn(async () => {
    expect(selectedBrainLocalEnvironment()).toMatchObject({ OTTO_HOME: home, PASEO_HOME: home });
    expect(process.env.OTTO_HOME).toBe(original.OTTO_HOME);
    expect(process.env.PASEO_HOME).toBe(original.PASEO_HOME);
  });
  await cli(effect).parseAsync(["brain", "serve", "--home", home], { from: "user" });
  expect(effect).toHaveBeenCalledOnce();
  expect(transport.connect).not.toHaveBeenCalled();
  expect(selectedBrainLocalEnvironment()).toBeUndefined();
});
it("rejects remote selection before any foreground effect instead of substituting a local host", async () => {
  const effect = vi.fn(async () => {});
  await expect(
    cli(effect).parseAsync(["brain", "serve", "--host", "remote.invalid:6788"], { from: "user" }),
  ).rejects.toMatchObject({ code: "LOCAL_OPERATION" });
  expect(effect).not.toHaveBeenCalled();
  expect(transport.connect).not.toHaveBeenCalled();
});
