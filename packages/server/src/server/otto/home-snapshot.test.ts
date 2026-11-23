import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPersistedConfig } from "../persisted-config.js";
import { OTTO_HOME_SNAPSHOT_DIRNAME, ensureOttoHomeSnapshot } from "./home-snapshot.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "otto-home-snapshot-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const otto09Projects = [
  { projectId: "p1", kanban: { adapter: "github", boardId: "7" }, knowledgeLocation: "repo" },
];

describe("Otto 0.9 home snapshot", () => {
  it("copies Paseo-owned stores unchanged before the first load", () => {
    const home = tempRoot();
    writeFileSync(path.join(home, "config.json"), '{ "version": 1 }\n');
    mkdirSync(path.join(home, "projects"));
    writeFileSync(path.join(home, "projects", "projects.json"), JSON.stringify(otto09Projects));

    loadPersistedConfig(home);

    const backup = path.join(home, OTTO_HOME_SNAPSHOT_DIRNAME, "projects", "projects.json");
    expect(JSON.parse(readFileSync(backup, "utf8"))).toEqual(otto09Projects);
  });

  it("takes the snapshot once", () => {
    const home = tempRoot();
    writeFileSync(path.join(home, "config.json"), '{ "version": 1 }\n');
    ensureOttoHomeSnapshot(home);
    writeFileSync(path.join(home, "config.json"), '{ "version": 1, "later": true }\n');
    ensureOttoHomeSnapshot(home);

    const backup = path.join(home, OTTO_HOME_SNAPSHOT_DIRNAME, "config.json");
    expect(readFileSync(backup, "utf8")).toBe('{ "version": 1 }\n');
  });

  it("takes no snapshot of a new home", () => {
    const home = path.join(tempRoot(), "new-home");
    loadPersistedConfig(home);
    ensureOttoHomeSnapshot(home);
    expect(existsSync(path.join(home, OTTO_HOME_SNAPSHOT_DIRNAME))).toBe(false);
  });
});
