import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeStoreResolver, type KnowledgeProject } from "./store-resolver.js";

// Fixtures stay inside this checkout. They never touch the installed Otto home.
const scratch = fileURLToPath(
  new URL("../../../../../../.tmp/knowledge-resolver-tests", import.meta.url),
);
const pending: string[] = [];
afterEach(async () => {
  for (const root of pending.splice(0)) {
    if (!root.startsWith(`${scratch}${path.sep}`))
      throw new Error("Fixture escaped scratch directory");
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, "case-"));
  pending.push(root);
  const project: KnowledgeProject = { projectId: "project-a", rootPath: path.join(root, "repo") };
  await mkdir(project.rootPath);
  const home = path.join(root, "host-home");
  const resolver = new KnowledgeStoreResolver({
    ottoHome: home,
    resolveProject: async () => project,
    defaultLocation: () => "host",
  });
  return { root, project, home, resolver };
}

describe("Knowledge store resolution", () => {
  it("keeps an existing repository tree despite a host default and missing index", async () => {
    const { project, resolver } = await fixture();
    await mkdir(path.join(project.rootPath, ".otto/knowledge"), { recursive: true });
    expect(await resolver.resolve(project.projectId)).toMatchObject({
      location: "repository",
      base: path.join(project.rootPath, ".otto"),
    });
  });

  it("gives the explicit override precedence and retains the old host directory identity", async () => {
    const { project, home, resolver } = await fixture();
    await mkdir(path.join(project.rootPath, ".otto"));
    await writeFile(path.join(project.rootPath, ".otto/KNOWLEDGE.md"), "User policy");
    project.knowledgeLocation = "host";
    project.knowledgeDirectoryName = "old-name-0123abcd";
    expect((await resolver.resolve(project.projectId)).base).toBe(
      path.join(home, "project-knowledge/old-name-0123abcd"),
    );
    project.knowledgeLocation = "repository";
    expect((await resolver.resolve(project.projectId)).location).toBe("repository");
  });

  it("refuses host allocation without persisted identity or with a path escape", async () => {
    const { project, resolver } = await fixture();
    await expect(resolver.resolve(project.projectId)).rejects.toThrow("persisted directory");
    project.knowledgeDirectoryName = "../other-project";
    await expect(resolver.resolve(project.projectId)).rejects.toThrow("path segment");
  });

  it("rejects mismatched project identities and relative roots without a fallback", async () => {
    const { project, resolver } = await fixture();
    project.knowledgeLocation = "repository";
    await expect(resolver.resolve("other-project")).rejects.toThrow("canonical project identity");
    project.rootPath = "relative-root";
    await expect(resolver.resolve(project.projectId)).rejects.toThrow("absolute root");
  });
});
