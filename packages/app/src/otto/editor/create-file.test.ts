import { expect, it } from "vitest";
import { createMissingSourceFile, type NewSourceFile } from "./create-file";
it("uses the existing exclusive create RPC with literal host-owned path parts, never a shell or an overwrite", async () => {
  const calls: NewSourceFile[] = [];
  const create = async (input: NewSourceFile) => {
    calls.push(input);
    return { success: true, error: null };
  };
  await createMissingSourceFile(create, {
    cwd: "C:/workspace",
    path: "C:/workspace/src/file with $(literal).ts",
  });
  expect(calls).toEqual([
    { cwd: "C:/workspace", parentPath: "src", name: "file with $(literal).ts", kind: "file" },
  ]);
  await expect(
    createMissingSourceFile(create, { cwd: "/workspace", path: "/outside/file.ts" }),
  ).rejects.toThrow("owning directory");
  expect(calls).toHaveLength(1);
  await expect(
    createMissingSourceFile(async () => ({ success: false, error: "Already exists" }), {
      cwd: "/workspace",
      path: "/workspace/file.ts",
    }),
  ).rejects.toThrow("Already exists");
});
