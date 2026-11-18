import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentProfile } from "@getpaseo/protocol/agent-profile";
import { isProfileMemoryEnabled, ProfileMemoryService } from "./profile-memory-service.js";
import { memoryTools } from "./tools.js";
import { ProfileMemoryStore } from "./profile-memory-store.js";

const logger = pino({ level: "silent" });
const PID = "personality_sprocket";
const REPO = "/repos/otto";

function personality(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: PID,
    name: "Sprocket",
    provider: "claude",
    model: "sonnet",
    ...overrides,
  } as AgentProfile;
}

let root: string;
let store: ProfileMemoryStore;
let roster: AgentProfile[];
let service: ProfileMemoryService;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "otto-memory-service-"));
  store = new ProfileMemoryStore(root);
  roster = [personality()];
  service = new ProfileMemoryService({
    store,
    readAgentProfiles: () => roster,
    // Every cwd under the fixture repo resolves to the repo, the way a worktree
    // and its main checkout share one project's lessons.
    resolveProjectRoot: async () => REPO,
    logger,
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("isProfileMemoryEnabled", () => {
  it("treats an absent flag as on, because empty memory costs nothing", () => {
    expect(isProfileMemoryEnabled(personality())).toBe(true);
  });

  it("honours an explicit opt-out", () => {
    expect(isProfileMemoryEnabled(personality({ memoryEnabled: false }))).toBe(false);
  });

  it("has nothing to enable for an unknown personality", () => {
    expect(isProfileMemoryEnabled(undefined)).toBe(false);
  });
});

describe("resolveBriefForSpawn", () => {
  it("injects nothing when the personality has learned nothing", async () => {
    expect(
      await service.resolveBriefForSpawn({
        personalityId: PID,
        personalityName: "Sprocket",
        cwd: REPO,
      }),
    ).toBeNull();
  });

  it("injects the personality's lessons, addressed to it by name", async () => {
    await service.record({
      personalityId: PID,
      lesson: "useUnistyles() is forbidden in this repo",
      scope: "project",
      cwd: REPO,
    });
    const brief = await service.resolveBriefForSpawn({
      personalityId: PID,
      personalityName: "Sprocket",
      cwd: REPO,
    });
    expect(brief).toContain("Sprocket");
    expect(brief).toContain("useUnistyles() is forbidden in this repo");
  });

  it("injects nothing when the personality is switched off", async () => {
    await service.record({ personalityId: PID, lesson: "a real lesson", scope: "global" });
    roster = [personality({ memoryEnabled: false })];
    expect(
      await service.resolveBriefForSpawn({
        personalityId: PID,
        personalityName: "Sprocket",
        cwd: REPO,
      }),
    ).toBeNull();
  });

  it("still injects for a personality deleted from the roster", async () => {
    // An agent keeps its spawn snapshot after the roster entry is gone, and it
    // should keep the lessons that identity accrued too.
    await service.record({
      personalityId: PID,
      lesson: "learned before the delete",
      scope: "global",
    });
    roster = [];
    const brief = await service.resolveBriefForSpawn({
      personalityId: PID,
      personalityName: "Sprocket",
      cwd: REPO,
    });
    expect(brief).toContain("learned before the delete");
  });

  it("leaves another project's lessons out", async () => {
    await service.record({
      personalityId: PID,
      lesson: "belongs to a different repository entirely",
      scope: "project",
      cwd: REPO,
    });
    const elsewhere = new ProfileMemoryService({
      store,
      readAgentProfiles: () => roster,
      resolveProjectRoot: async () => "/repos/somewhere-else",
      logger,
    });
    expect(
      await elsewhere.resolveBriefForSpawn({
        personalityId: PID,
        personalityName: "Sprocket",
        cwd: "/repos/somewhere-else",
      }),
    ).toBeNull();
  });

  it("never fails a spawn when memory cannot be read", async () => {
    const broken = new ProfileMemoryService({
      store,
      readAgentProfiles: () => {
        throw new Error("roster exploded");
      },
      resolveProjectRoot: async () => REPO,
      logger,
    });
    expect(
      await broken.resolveBriefForSpawn({
        personalityId: PID,
        personalityName: "Sprocket",
        cwd: REPO,
      }),
    ).toBeNull();
  });
});

describe("record", () => {
  it("scopes a project lesson to the resolved repo root, not the raw cwd", async () => {
    await service.record({
      personalityId: PID,
      lesson: "a repo-scoped fact",
      scope: "project",
      cwd: `${REPO}/packages/server`,
    });
    expect((await service.list(PID))[0]?.projectRoot).toBe(REPO);
  });

  it("refuses to widen a project lesson when its cwd is unknown", async () => {
    await expect(
      service.record({ personalityId: PID, lesson: "project only", scope: "project" }),
    ).rejects.toThrow("project");
    expect(await service.list(PID)).toEqual([]);
  });
});

describe("view", () => {
  it("returns every entry but scopes the brief to the asked-about project", async () => {
    await service.record({ personalityId: PID, lesson: "global truth", scope: "global" });
    // Written through the store directly: this fixture's resolveProjectRoot
    // always answers REPO, which is the point of the test above it.
    await store.record({
      personalityId: PID,
      lesson: "only true in the other repository",
      scope: "project",
      projectRoot: "/repos/other",
      source: "agent",
    });
    const view = await service.view({ personalityId: PID, projectRoot: REPO });
    expect(view.entries).toHaveLength(2);
    expect(view.brief.text).toContain("global truth");
    expect(view.brief.text).not.toContain("only true in the other repository");
  });

  it("names the personality even when it is no longer in the roster", async () => {
    roster = [];
    const view = await service.view({ personalityId: PID });
    expect(view.personalityName).toBe(PID);
    expect(view.enabled).toBe(false);
  });
});

describe("transfer", () => {
  it("stamps the origin personality's name onto what it hands over", async () => {
    await service.record({ personalityId: PID, lesson: "worth keeping", scope: "global" });
    roster = [personality(), personality({ id: "personality_other", name: "Cog" })];
    const result = await service.transfer({
      fromPersonalityId: PID,
      toPersonalityId: "personality_other",
    });
    expect(result.transferred).toBe(1);
    expect((await service.list("personality_other"))[0]?.transferredFrom).toBe("Sprocket");
    expect(await service.list(PID)).toHaveLength(0);
  });
});

it("exposes the bound Profile's scoped MCP lessons and reports counts without sending lesson text", async () => {
  let bound: { id: string; cwd: string } | null = { id: PID, cwd: REPO };
  const tools = memoryTools(service, () => bound);
  async function call(name: string, input: unknown) {
    const tool = tools.find((entry) => entry.name === name);
    if (!tool) throw new Error("Missing memory tool");
    return (await tool.handler(input, {})).content[0].text;
  }
  await call("remember_lesson", { lesson: "Run the project lint before submitting changes." });
  const other = await store.add({
    personalityId: PID,
    lesson: "Private check for another project",
    scope: "project",
    projectRoot: "/other",
    source: "user",
  });
  expect(other.outcome).toBe("added");
  const entries = await service.list(PID);
  const visible = entries.find((entry) => entry.projectRoot === REPO);
  const hidden = entries.find((entry) => entry.projectRoot === "/other");
  expect(await call("review_lessons", {})).toContain(visible?.id);
  expect(await call("review_lessons", {})).not.toContain(hidden?.id);
  await expect(call("revise_lesson", { handle: hidden?.id, forget: true })).rejects.toThrow(
    "unavailable",
  );
  expect(
    await call("revise_lesson", {
      handle: visible?.id,
      lesson: "Run scoped lint before committing.",
    }),
  ).toContain("true");
  expect(await service.manage({ kind: "counts" }, async () => REPO)).toEqual({
    kind: "counts",
    counts: { [PID]: 2 },
  });
  bound = null;
  await expect(call("review_lessons", {})).rejects.toThrow("named Profile");
});
