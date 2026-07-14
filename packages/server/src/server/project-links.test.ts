import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import pino from "pino";
import { FileBackedProjectLinkStore } from "./project-links.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeStore(): { store: FileBackedProjectLinkStore; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), "project-links-"));
  tempDirs.push(dir);
  const filePath = join(dir, "project-links.json");
  return { store: new FileBackedProjectLinkStore(filePath, pino({ level: "silent" })), filePath };
}

const AT = "2026-07-14T00:00:00.000Z";

describe("FileBackedProjectLinkStore", () => {
  test("a link is undirected: areLinked holds in both directions", async () => {
    const { store } = makeStore();
    await store.link("a", "b", AT);

    expect(await store.areLinked("a", "b")).toBe(true);
    expect(await store.areLinked("b", "a")).toBe(true);
    expect(await store.areLinked("a", "c")).toBe(false);
  });

  test("linking is idempotent and deduped regardless of order", async () => {
    const { store } = makeStore();
    await store.link("b", "a", AT);
    await store.link("a", "b", AT);
    await store.link("b", "a", AT);

    expect(await store.list()).toHaveLength(1);
  });

  test("a project cannot be linked to itself", async () => {
    const { store } = makeStore();
    await store.link("a", "a", AT);

    expect(await store.list()).toHaveLength(0);
    expect(await store.areLinked("a", "a")).toBe(false);
  });

  test("listLinkedProjectIds returns the other endpoint of every link", async () => {
    const { store } = makeStore();
    await store.link("a", "b", AT);
    await store.link("a", "c", AT);
    await store.link("d", "e", AT);

    expect((await store.listLinkedProjectIds("a")).sort()).toEqual(["b", "c"]);
    expect(await store.listLinkedProjectIds("d")).toEqual(["e"]);
    expect(await store.listLinkedProjectIds("z")).toEqual([]);
  });

  test("unlink removes the pair in either direction", async () => {
    const { store } = makeStore();
    await store.link("a", "b", AT);
    await store.unlink("b", "a");

    expect(await store.areLinked("a", "b")).toBe(false);
    expect(await store.list()).toHaveLength(0);
  });

  test("removeAllForProject drops every link that references the project (cascade)", async () => {
    const { store } = makeStore();
    await store.link("a", "b", AT);
    await store.link("a", "c", AT);
    await store.link("b", "c", AT);

    await store.removeAllForProject("a");

    expect(await store.areLinked("a", "b")).toBe(false);
    expect(await store.areLinked("a", "c")).toBe(false);
    // Links not touching "a" survive.
    expect(await store.areLinked("b", "c")).toBe(true);
    expect(await store.list()).toHaveLength(1);
  });

  test("distinct pairs do not collide when ids contain spaces", async () => {
    // Project ids for local projects are raw filesystem paths, which routinely
    // contain spaces. A space-joined pair key made unrelated pairs collide:
    // ["Alice","Bob Corp"] and ["Alice Bob","Corp"] both flattened to the same
    // string, so areLinked returned true for a pair the user never linked.
    const { store } = makeStore();
    await store.link("Alice", "Bob Corp", AT);

    expect(await store.areLinked("Alice", "Bob Corp")).toBe(true);
    expect(await store.areLinked("Alice Bob", "Corp")).toBe(false);
    expect(await store.listLinkedProjectIds("Alice Bob")).toEqual([]);
    expect(await store.list()).toHaveLength(1);
  });

  test("links persist across store instances (canonical order on disk)", async () => {
    const { store, filePath } = makeStore();
    await store.link("z", "a", AT);

    const raw = JSON.parse(readFileSync(filePath, "utf8")) as Array<Record<string, string>>;
    expect(raw).toHaveLength(1);
    // Stored canonically (a < z), independent of author order.
    expect(raw[0]).toMatchObject({ projectAId: "a", projectBId: "z" });

    const reopened = new FileBackedProjectLinkStore(filePath, pino({ level: "silent" }));
    expect(await reopened.areLinked("a", "z")).toBe(true);
  });
});
