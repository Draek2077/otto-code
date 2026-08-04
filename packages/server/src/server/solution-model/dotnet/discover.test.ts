import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverSolutions } from "./discover.js";

/**
 * Discovery is the one part of this subsystem that runs for **every** workspace, so its cost and
 * its silence are the properties under test - not its cleverness.
 */
describe("solution discovery", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "otto-solution-discover-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function touch(relativePath: string): Promise<void> {
    const full = join(root, relativePath);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, "");
  }

  it("finds nothing in a workspace with no solution, which is the common case", async () => {
    await touch("src/index.ts");
    expect(await discoverSolutions(root)).toEqual([]);
  });

  it("finds both formats and reports each one's own", async () => {
    await touch("App.sln");
    await touch("nested/Other.slnx");

    const found = await discoverSolutions(root);

    expect(found.map((ref) => [ref.name, ref.format])).toEqual([
      ["App", "sln"],
      ["Other", "slnx"],
    ]);
  });

  it("returns absolute, forward-slashed paths", async () => {
    await touch("App.sln");
    const [ref] = await discoverSolutions(root);
    expect(ref.path.includes("\\")).toBe(false);
    expect(ref.path.endsWith("/App.sln")).toBe(true);
  });

  /**
   * `dotnet sln migrate` leaves the classic file beside the new one. Two picker entries for one
   * solution is bad; letting the user pick the stale one is worse.
   */
  it("prefers .slnx over the .sln a migration left beside it", async () => {
    await touch("App.sln");
    await touch("App.slnx");

    const found = await discoverSolutions(root);

    expect(found).toHaveLength(1);
    expect(found[0].format).toBe("slnx");
  });

  it("keeps a .sln whose name differs from a neighbouring .slnx", async () => {
    await touch("App.sln");
    await touch("Tools.slnx");
    expect(await discoverSolutions(root)).toHaveLength(2);
  });

  // The walk runs on every workspace open. A repo with a large node_modules must not pay for it,
  // and a solution copied into build output is not one the user means.
  it.each(["node_modules", ".git", "bin", "obj"])("never descends into %s", async (skipped) => {
    await touch(`${skipped}/Buried.sln`);
    expect(await discoverSolutions(root)).toEqual([]);
  });

  it("stops at the depth bound rather than walking the whole tree", async () => {
    await touch("a/b/c/d/e/Deep.sln");
    expect(await discoverSolutions(root, { maxDepth: 2 })).toEqual([]);
    expect(await discoverSolutions(root, { maxDepth: 6 })).toHaveLength(1);
  });

  it("treats an unreadable directory as a fact about the machine, not an error", async () => {
    await expect(discoverSolutions(join(root, "does-not-exist"))).resolves.toEqual([]);
  });
});
