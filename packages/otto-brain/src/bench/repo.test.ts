import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { fixtureRoot } from "../../test-fixtures.js";
import { createBenchmarkCheckout, Repo, run } from "./repo.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function sourceFixture() {
  const root = fs.mkdtempSync(path.join(fixtureRoot(), "brain-repo-"));
  roots.push(root);
  const source = path.join(root, "source with spaces & literal");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "value.txt"), "committed");
  const commands = [
    ["init", "--quiet"],
    ["add", "--", "value.txt"],
    [
      "-c",
      "user.name=Draekz",
      "-c",
      "user.email=draekz@gmail.com",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ],
  ];
  for (const args of commands) expect((await run("git", args, { cwd: source })).ok).toBe(true);
  const sha = (await run("git", ["rev-parse", "HEAD"], { cwd: source })).stdout.trim();
  return { root, source, sha };
}

it("keeps dirty source data intact while benchmark resets affect only its owned clone", async () => {
  const { root, source, sha } = await sourceFixture();
  fs.writeFileSync(path.join(source, "value.txt"), "user's unsaved work");
  fs.writeFileSync(path.join(source, "untracked.txt"), "keep this too");
  const checkout = await createBenchmarkCheckout(source, path.join(root, "scratch"));
  const repo = new Repo({
    dir: checkout.dir,
    workspace: "fixture",
    workspaceDir: ".",
    ownedRoot: checkout.root,
  });
  try {
    await repo.reset(sha);
    expect(fs.readFileSync(path.join(checkout.dir, "value.txt"), "utf8")).toBe("committed");
    fs.writeFileSync(path.join(checkout.dir, "discard.txt"), "benchmark edit");
    await repo.reset(sha);
    expect(fs.existsSync(path.join(checkout.dir, "discard.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(source, "value.txt"), "utf8")).toBe("user's unsaved work");
    expect(fs.readFileSync(path.join(source, "untracked.txt"), "utf8")).toBe("keep this too");
    await expect(repo.test()).rejects.toThrow("explicit oracle file filters");
  } finally {
    checkout.dispose();
  }
  expect(fs.existsSync(checkout.root)).toBe(false);
  expect(fs.existsSync(source)).toBe(true);
});

it("refuses destructive operations on an ordinary source checkout", async () => {
  const { source, sha } = await sourceFixture();
  const repo = new Repo({ dir: source, workspace: "fixture", workspaceDir: "." });
  await expect(repo.reset(sha)).rejects.toThrow("Brain-owned disposable checkout");
  await expect(repo.checkoutPaths(sha, ["value.txt"])).rejects.toThrow(
    "Brain-owned disposable checkout",
  );
  await expect(repo.ensureDependencies()).rejects.toThrow("Brain-owned disposable checkout");
  expect(() => new Repo({ dir: source, workspace: "fixture", workspaceDir: "../outside" })).toThrow(
    "inside its checkout",
  );
});

it("refuses a forged ownership marker before resetting any files", async () => {
  const { root, source, sha } = await sourceFixture();
  fs.writeFileSync(path.join(root, "owner.json"), JSON.stringify({ checkout: source, source }));
  const repo = new Repo({ dir: source, workspace: "fixture", workspaceDir: ".", ownedRoot: root });
  await expect(repo.reset(sha)).rejects.toThrow("ownership does not match");
});
