import { describe, expect, it } from "vitest";
import { createCli } from "./cli.js";

function commandHelp(
  parent: { commands: Array<{ name(): string; helpInformation(): string }> },
  name: string,
) {
  const command = parent.commands.find((candidate) => candidate.name() === name);
  expect(command, `Expected ${name} command`).toBeDefined();
  return command?.helpInformation() ?? "";
}

describe("canonical CLI surface", () => {
  it("shows workspace and heartbeat commands while hiding worktree compatibility", () => {
    const cli = createCli();
    const help = cli.helpInformation();
    expect(help).toContain("workspace");
    expect(help).toContain("heartbeat");
    expect(help).not.toContain("worktree");
  });

  it("names explicit workspace creation without exposing older syntax", () => {
    const run = createCli().commands.find((command) => command.name() === "run");
    const help = run?.helpInformation();
    expect(help).toContain("--new-workspace <local|worktree>");
    expect(help).not.toContain("--isolation");
    expect(help).not.toContain("--worktree <name>");
  });

  it("offers the worktree creation options on run", () => {
    const run = createCli().commands.find((command) => command.name() === "run");
    const help = run?.helpInformation();
    expect(help).toContain("--worktree-mode <mode>");
    expect(help).toContain("--worktree-slug <slug>");
    expect(help).toContain("--new-branch <name>");
    expect(help).toContain("--branch <name>");
    expect(help).toContain("--pr-number <n>");
    expect(help).toContain("--forge <forge>");
  });

  it("uses background for execution and reserves detach for ownership", () => {
    const run = createCli().commands.find((command) => command.name() === "run");
    expect(run?.helpInformation()).toContain("--background");
    expect(run?.helpInformation()).not.toContain("--detach");
  });

  it("offers thinking configuration when running, updating, and scheduling agents", () => {
    const cli = createCli();
    const run = cli.commands.find((command) => command.name() === "run");
    const agent = cli.commands.find((command) => command.name() === "agent");
    const update = agent?.commands.find((command) => command.name() === "update");
    const schedule = cli.commands.find((command) => command.name() === "schedule");
    const scheduleCreate = schedule?.commands.find((command) => command.name() === "create");

    expect(run?.helpInformation()).toContain("--thinking <id>");
    expect(update?.helpInformation()).toContain("--thinking <id>");
    expect(scheduleCreate?.helpInformation()).toContain("--thinking <id>");
  });

  it("offers opening an existing agent in the desktop app", () => {
    const agent = createCli().commands.find((command) => command.name() === "agent");
    const open = agent?.commands.find((command) => command.name() === "open");

    expect(open?.helpInformation()).toContain("<agent-id>");
    expect(open?.helpInformation()).toContain("--server <server-id>");
  });

  it("exposes the Graph Workflow lifecycle without a file execution shortcut", () => {
    const workflow = createCli().commands.find((command) => command.name() === "workflow");
    const graph = workflow?.commands.find((command) => command.name() === "graph");
    const validate = graph?.commands.find((command) => command.name() === "validate");
    const run = graph?.commands.find((command) => command.name() === "run");

    expect(graph?.helpInformation()).toContain("ls");
    expect(graph?.helpInformation()).toContain("inspect");
    expect(validate?.helpInformation()).toContain("<file>");
    expect(run?.helpInformation()).toContain("--input <key=value>");
    expect(run?.helpInformation()).not.toContain("--file");
  });

  it("exposes the durable Artifact library, data, storage, and recovery commands", () => {
    const artifact = createCli().commands.find((command) => command.name() === "artifact");
    expect(artifact, "Expected artifact command").toBeDefined();
    if (!artifact) return;

    expect(commandHelp(artifact, "create")).toContain("--project <root>");
    expect(commandHelp(artifact, "create")).toContain("--description <text>");
    expect(commandHelp(artifact, "ls")).toContain("--project <project>");
    expect(commandHelp(artifact, "data")).toContain("<id>");
    expect(commandHelp(artifact, "update-data")).toContain("--data <json>");
    expect(commandHelp(artifact, "update-data")).toContain("without regenerating");
    expect(commandHelp(artifact, "cancel")).toContain("<id>");
    expect(commandHelp(artifact, "cancel")).toContain("last known good output");
    expect(commandHelp(artifact, "regenerate")).toContain("<id>");
    expect(commandHelp(artifact, "regenerate")).toContain("Explicitly regenerate");
    expect(commandHelp(artifact, "move")).toContain("--to <location>");
    expect(commandHelp(artifact, "move")).toContain("repository or host");
    expect(commandHelp(artifact, "repair")).toContain("<id>");
    expect(commandHelp(artifact, "repair")).toContain("last known good output");
  });

  it("exposes daemon-owned Architectural View delivery", () => {
    const architecturalView = createCli().commands.find(
      (command) => command.name() === "architectural-view",
    );
    expect(architecturalView, "Expected architectural-view command").toBeDefined();
    if (!architecturalView) return;

    const deliver = commandHelp(architecturalView, "deliver");
    expect(deliver).toContain("--workspace <id>");
    expect(deliver).toContain("--source <path>");
    expect(deliver).toContain("--link <kind:id>");
    const draft = commandHelp(architecturalView, "draft");
    expect(draft).toContain("create");
    expect(draft).toContain("update");
    expect(draft).toContain("publish");
    expect(draft).toContain("discard");
  });
});
