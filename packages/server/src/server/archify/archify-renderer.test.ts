import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ArchifyRenderer } from "./archify-renderer.js";

const temporaryDirectories: string[] = [];

function repositoryRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "otto-archify-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ArchifyRenderer", () => {
  it("delivers a validated interactive Architecture document", async () => {
    const targetDirectory = await createTemporaryDirectory();

    const delivery = await new ArchifyRenderer().deliverArchitectureFile({
      specificationPath: join(
        repositoryRoot(),
        "vendor",
        "archify",
        "archify",
        "examples",
        "web-app.architecture.json",
      ),
      htmlPath: join(targetDirectory, "sample-web-app.architecture.html"),
    });

    expect(delivery.receipt.ok).toBe(true);
    expect(delivery.specificationPath).toContain("web-app.architecture.json");
    await expect(readFile(delivery.htmlPath, "utf8")).resolves.toContain("<svg");
  });

  it("rejects a non-HTML output", async () => {
    await expect(
      new ArchifyRenderer().deliverArchitectureFile({
        specificationPath: join(
          repositoryRoot(),
          "vendor",
          "archify",
          "archify",
          "examples",
          "web-app.architecture.json",
        ),
        htmlPath: join(await createTemporaryDirectory(), "view.txt"),
      }),
    ).rejects.toThrow("HTML file");
  });
});
