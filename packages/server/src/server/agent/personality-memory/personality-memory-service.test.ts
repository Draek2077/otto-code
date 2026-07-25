import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentPersonality } from "@otto-code/protocol/messages";
import {
  isPersonalityMemoryEnabled,
  PersonalityMemoryService,
} from "./personality-memory-service.js";
import { PersonalityMemoryStore } from "./personality-memory-store.js";

const logger = pino({ level: "silent" });
const PID = "personality_sprocket";
const REPO = "/repos/otto";

function personality(overrides: Partial<AgentPersonality> = {}): AgentPersonality {
  return {
    id: PID,
    name: "Sprocket",
    provider: "claude",
    model: "sonnet",
    ...overrides,
  } as AgentPersonality;
}

let root: string;
let store: PersonalityMemoryStore;
let roster: AgentPersonality[];
let service: PersonalityMemoryService;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "otto-memory-service-"));
  store = new PersonalityMemoryStore(root);
  roster = [personality()];
  service = new PersonalityMemoryService({
    store,
    readAgentPersonalities: () => roster,
    // Every cwd under the fixture repo resolves to the repo, the way a worktree
    // and its main checkout share one project's lessons.
    resolveProjectRoot: async () => REPO,
    logger,
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("isPersonalityMemoryEnabled", () => {
  it("treats an absent flag as on, because empty memory costs nothing", () => {
    expect(isPersonalityMemoryEnabled(personality())).toBe(true);
  });

  it("honours an explicit opt-out", () => {
    expect(isPersonalityMemoryEnabled(personality({ memoryEnabled: false }))).toBe(false);
  });

  it("has nothing to enable for an unknown personality", () => {
    expect(isPersonalityMemoryEnabled(undefined)).toBe(false);
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
    const elsewhere = new PersonalityMemoryService({
      store,
      readAgentPersonalities: () => roster,
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
    const broken = new PersonalityMemoryService({
      store,
      readAgentPersonalities: () => {
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

  it("stores a project-scoped lesson as global when there is no cwd to scope it to", async () => {
    // A daemon-internal agent has no working directory; dropping the lesson
    // would lose it, and inventing a root would hide it from every project.
    await service.record({ personalityId: PID, lesson: "no cwd here", scope: "project" });
    expect((await service.list(PID))[0]?.scope).toBe("global");
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
