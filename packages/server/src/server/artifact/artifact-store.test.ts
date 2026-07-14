import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_ARTIFACT_RUNS } from "@otto-code/protocol/artifacts/types";
import type { ArtifactMetadata, ArtifactRun } from "@otto-code/protocol/artifacts/types";
import { ArtifactStore } from "./artifact-store.js";

function metadataFixture(overrides: Partial<ArtifactMetadata> = {}): ArtifactMetadata {
  return {
    id: "art-1",
    name: "Perf report",
    description: "Summarize the perf run",
    projectId: "/repo/root",
    filePath: "/tmp/.otto/artifacts/art-1.html",
    kind: "html",
    starred: false,
    status: "generating",
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    generationAgentId: null,
    generationProvider: "opencode",
    generationModel: "base-model",
    generationModeId: null,
    generationThinkingOptionId: "medium",
    errorMessage: null,
    ...overrides,
  };
}

function runFixture(overrides: Partial<ArtifactRun> = {}): ArtifactRun {
  return {
    id: "run-1",
    trigger: "create",
    status: "running",
    startedAt: "2026-07-08T00:00:00.000Z",
    endedAt: null,
    agentId: null,
    provider: "opencode",
    model: "base-model",
    error: null,
    ...overrides,
  };
}

describe("ArtifactStore run history", () => {
  let cwd: string;
  let store: ArtifactStore;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "artifact-store-"));
    store = new ArtifactStore(cwd);
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("create seeds an empty run history that inspect exposes and get/list strip", async () => {
    await store.create(metadataFixture());

    const inspected = await store.inspect("art-1");
    expect(inspected?.runs).toEqual([]);

    const got = await store.get("art-1");
    const [listed] = await store.list();
    expect(got).not.toHaveProperty("runs");
    expect(listed).not.toHaveProperty("runs");
  });

  it("round-trips the generation personality name on metadata and runs", async () => {
    await store.create(metadataFixture({ generationPersonalityName: "Pixel" }));
    await store.appendRun("art-1", runFixture({ personalityName: "Pixel" }));

    const got = await store.get("art-1");
    expect(got?.generationPersonalityName).toBe("Pixel");

    const inspected = await store.inspect("art-1");
    expect(inspected?.runs[0]?.personalityName).toBe("Pixel");
  });

  it("appends runs, stamps the agent id, and closes out the current run", async () => {
    await store.create(metadataFixture());
    await store.appendRun("art-1", runFixture());

    await store.patchCurrentRun("art-1", { agentId: "agent-1" });
    await store.patchCurrentRun("art-1", {
      status: "succeeded",
      endedAt: "2026-07-08T00:01:00.000Z",
    });

    const inspected = await store.inspect("art-1");
    expect(inspected?.runs).toHaveLength(1);
    expect(inspected?.runs[0]).toMatchObject({
      id: "run-1",
      agentId: "agent-1",
      status: "succeeded",
      endedAt: "2026-07-08T00:01:00.000Z",
    });
  });

  it("patchCurrentRun only touches the most recent running run", async () => {
    await store.create(metadataFixture());
    await store.appendRun("art-1", runFixture({ id: "run-1", status: "failed" }));
    await store.appendRun("art-1", runFixture({ id: "run-2", trigger: "regenerate" }));

    await store.patchCurrentRun("art-1", { status: "succeeded" });

    const inspected = await store.inspect("art-1");
    expect(inspected?.runs.map((r) => r.status)).toEqual(["failed", "succeeded"]);
  });

  it("patchCurrentRun no-ops when no run is in flight", async () => {
    await store.create(metadataFixture());
    await store.appendRun("art-1", runFixture({ status: "succeeded" }));

    await expect(store.patchCurrentRun("art-1", { status: "failed" })).resolves.toBeUndefined();
    const inspected = await store.inspect("art-1");
    expect(inspected?.runs[0]?.status).toBe("succeeded");
  });

  it("caps retained run history", async () => {
    await store.create(metadataFixture());
    for (let i = 0; i < MAX_ARTIFACT_RUNS + 5; i++) {
      await store.appendRun("art-1", runFixture({ id: `run-${i}`, status: "succeeded" }));
    }

    const inspected = await store.inspect("art-1");
    expect(inspected?.runs).toHaveLength(MAX_ARTIFACT_RUNS);
    // Oldest entries pruned, newest retained.
    expect(inspected?.runs[0]?.id).toBe("run-5");
    expect(inspected?.runs.at(-1)?.id).toBe(`run-${MAX_ARTIFACT_RUNS + 4}`);
  });

  it("parses legacy records written before run history existed (no migration)", async () => {
    // Simulate an on-disk file from before `runs` was added.
    const dir = join(cwd, ".otto", "artifacts");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "art-1.json"), JSON.stringify(metadataFixture()), "utf-8");

    const inspected = await store.inspect("art-1");
    expect(inspected?.runs).toEqual([]);

    // A subsequent append upgrades the file in place.
    await store.appendRun("art-1", runFixture());
    const raw = JSON.parse(await readFile(join(dir, "art-1.json"), "utf-8"));
    expect(raw.runs).toHaveLength(1);
  });
});

describe("ArtifactStore id validation", () => {
  let cwd: string;
  let store: ArtifactStore;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "artifact-store-"));
    store = new ArtifactStore(cwd);
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("rejects path-traversal ids before touching the filesystem", async () => {
    // A traversal id must never let delete()/inspect()/get() escape the
    // artifacts dir and read or unlink an unrelated file.
    const outside = join(cwd, "outside-secret.json");
    await writeFile(outside, JSON.stringify({ secret: true }), "utf-8");

    for (const badId of ["../../outside-secret", "..\\..\\outside-secret", "a/b", "a\0b"]) {
      await expect(store.delete(badId)).rejects.toThrow(/Invalid artifact id/);
      await expect(store.inspect(badId)).rejects.toThrow(/Invalid artifact id/);
      await expect(store.get(badId)).rejects.toThrow(/Invalid artifact id/);
    }

    // The file outside the artifacts dir is untouched.
    expect(JSON.parse(await readFile(outside, "utf-8"))).toEqual({ secret: true });
  });

  it("accepts the generator's hex id shape", async () => {
    await store.create(metadataFixture({ id: "a1b2c3d4" }));
    expect(await store.get("a1b2c3d4")).toMatchObject({ id: "a1b2c3d4" });
  });
});
