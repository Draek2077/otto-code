import { describe, expect, it } from "vitest";
import path from "node:path";
import { EditorOperations } from "./lifetime.js";

describe("editor admission lifetime", () => {
  it("invalidates delayed callbacks on disconnect without poisoning a fresh connection", async () => {
    const scopes = new EditorOperations();
    let finish: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let valid: (() => boolean) | undefined;
    const operation = scopes
      .run("client", path.resolve("workspace"), async (current) => {
        valid = current;
        await wait;
        return 42;
      })
      .catch((error: unknown) => error);
    scopes.releaseClient("client");
    expect(valid?.()).toBe(false);
    expect(
      await scopes.run("client", path.resolve("workspace"), async (current) => current()),
    ).toBe(true);
    finish?.();
    expect(await operation).toMatchObject({ kind: "closed" });
    scopes.close();
  });
  it("invalidates workspace work before child admission and refuses work after shutdown", async () => {
    const scopes = new EditorOperations();
    const root = path.resolve("workspace");
    let finish: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const operation = scopes
      .run("client", root, async (current) => {
        await wait;
        expect(current()).toBe(false);
        return "late";
      })
      .catch((error: unknown) => error);
    scopes.releaseWorkspace(root);
    finish?.();
    expect(await operation).toMatchObject({ kind: "closed" });
    scopes.close();
    await expect(scopes.run("new", root, async () => "forbidden")).rejects.toMatchObject({
      kind: "closed",
    });
  });
});
