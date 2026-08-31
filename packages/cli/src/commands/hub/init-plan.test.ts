import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { discoverHubBundle } from "./deploy-bundle.js";
import { runHubDeploy } from "./deploy.js";
import {
  createHubInitScaffold,
  hubLoginResumeCommand,
  planHubInitOpening,
  resolveHubInitConnection,
  resolveHubInitProjects,
  type HubInitProvider,
} from "./init-plan.js";
import { githubRepositoryFromRemote } from "./init.js";

const directories: string[] = [];
const project = (slug: string) => ({
  id: "7e950d84-eec0-4e18-b1f9-9c115bdb31e4",
  slug,
  name: slug.toUpperCase(),
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("Hub init planning", () => {
  it("prints direct resumable commands for declined login continuations", () => {
    expect(hubLoginResumeCommand("connect", "https://hub.test")).toBe(
      "otto hub connect https://hub.test",
    );
    expect(hubLoginResumeCommand("init", "https://hub.test")).toBe("otto hub init");
  });
  it("includes login only when there is no active login", () => {
    expect(planHubInitOpening({ loggedIn: false, ottoDirectoryExists: false })).toEqual({
      replaceExisting: false,
      steps: ["login", "connect", "project", "scaffold"],
    });
    expect(planHubInitOpening({ loggedIn: true, ottoDirectoryExists: false })).toEqual({
      replaceExisting: false,
      steps: ["connect", "project", "scaffold"],
    });
  });

  it("plans a confirmed replacement for an existing .otto directory", () => {
    expect(planHubInitOpening({ loggedIn: true, ottoDirectoryExists: true })).toEqual({
      replaceExisting: true,
      steps: ["connect", "project", "scaffold"],
    });
  });

  it("stops, defaults, or asks according to the project count", () => {
    expect(resolveHubInitProjects([])).toEqual({ kind: "none" });
    expect(resolveHubInitProjects([project("one")])).toEqual({
      kind: "selected",
      project: project("one"),
    });
    expect(resolveHubInitProjects([project("one"), project("two")])).toEqual({
      kind: "choose",
      projects: [project("one"), project("two")],
    });
  });

  it("reuses a connected daemon, waits for reconnect, and rejects a different Hub", () => {
    const status = {
      state: "connected",
      daemonId: "daemon-1",
      hubOrigin: "https://hub.test",
      scopes: ["hub.execution.*"],
      connectedAt: null,
      lastError: null,
    };
    expect(resolveHubInitConnection(status, "https://hub.test")).toEqual({
      kind: "connected",
      daemonId: "daemon-1",
    });
    expect(resolveHubInitConnection(status, "https://other.test")).toEqual({
      kind: "conflict",
      origin: "https://hub.test",
    });
    expect(
      resolveHubInitConnection({ ...status, state: "reconnecting" }, "https://hub.test"),
    ).toEqual({ kind: "pending", state: "reconnecting" });
    expect(
      resolveHubInitConnection(
        { ...status, state: "not_connected", daemonId: null, hubOrigin: null },
        "https://hub.test",
      ),
    ).toEqual({ kind: "connect" });
  });
});

describe("Hub init scaffold", () => {
  it("omits mode for a provider that explicitly exposes none", () => {
    const scaffold = createHubInitScaffold({
      cwd: "/workspace",
      daemonSlug: "build-studio",
      agent: { provider: "pi", model: "default" },
      provider: "slack",
      providerFilters: { workspace: "T123456", user: "U123456" },
    });

    expect(YAML.parse(scaffold.hub)).toMatchObject({
      agents: { starter: { provider: "pi", model: "default" } },
    });
    expect(YAML.parse(scaffold.hub).agents.starter.mode).toBeUndefined();
  });

  it.each([
    ["github", { repo: "Draek2077/otto-code", user: "boudra" }],
    ["slack", { workspace: "T123456", user: "U123456" }],
    ["discord", { guild: "123456789", user: "987654321" }],
  ] satisfies readonly [HubInitProvider, Record<string, string>][])(
    "creates a closed %s trigger that the deploy discovery path accepts",
    async (provider, providerFilters) => {
      const cwd = await temporaryDirectory();
      const scaffold = createHubInitScaffold({
        cwd,
        daemonSlug: "build-studio",
        agent: {
          provider: "codex",
          model: "gpt-5",
          mode: "full-access",
        },
        provider,
        providerFilters,
      });
      await mkdir(path.join(cwd, ".otto", "workflows"), { recursive: true });
      await writeFile(path.join(cwd, ".otto", "hub.yml"), scaffold.hub);
      await writeFile(path.join(cwd, scaffold.workflowPath), scaffold.workflow);

      const bundle = await discoverHubBundle({ cwd, project: "otto" });
      expect(bundle.workflowCount).toBe(1);
      expect(bundle.files.map((file) => file.path)).toEqual([
        ".otto/hub.yml",
        scaffold.workflowPath,
      ]);
      const parsed = YAML.parse(scaffold.workflow) as {
        filters: { from_users: string[]; channels?: string[] };
      };
      expect(parsed.filters.from_users).toEqual([providerFilters.user]);
      if (provider === "slack") expect(parsed.filters.workspace).toBe("T123456");
      if (provider === "discord") expect(parsed.filters.guild).toBe("123456789");
      expect(parsed.filters.channels).toBeUndefined();
      expect(YAML.parse(scaffold.hub)).toMatchObject({
        agents: { starter: { provider: "codex", model: "gpt-5", mode: "full-access" } },
      });

      let validatedPaths: readonly string[] = [];
      const result = await runHubDeploy(
        { project: "otto", hub: "https://hub.test", dryRun: true },
        {
          cwd,
          env: { OTTO_HUB_API_KEY: "test-key" },
          reporter: { progress() {} },
          hub: {
            async validateConfiguration(input) {
              validatedPaths = input.files.map((file) => file.path);
              for (const file of input.files) YAML.parse(file.content);
              return { projectSlug: input.projectSlug, valid: true };
            },
            async installConfiguration() {
              throw new Error("dry-run must not install");
            },
          },
        },
      );
      expect(result.data).toMatchObject({ projectSlug: "otto", valid: true, workflows: 1 });
      expect(validatedPaths).toEqual([".otto/hub.yml", scaffold.workflowPath]);
    },
  );
});

describe("GitHub origin detection", () => {
  it.each([
    ["git@github.com:Draek2077/otto-code.git", "Draek2077/otto-code"],
    ["ssh://git@github.com/Draek2077/otto-code.git", "Draek2077/otto-code"],
    ["https://github.com/Draek2077/otto-code.git", "Draek2077/otto-code"],
    ["https://gitlab.com/Draek2077/otto-code.git", undefined],
  ])("resolves %s", (remote, expected) => {
    expect(githubRepositoryFromRemote(remote)).toBe(expected);
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "otto-hub-init-"));
  directories.push(directory);
  return directory;
}
