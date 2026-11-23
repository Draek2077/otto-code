import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, writeFile, realpath, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hostUploadFiles } from "./file-input.js";
const scratch = fileURLToPath(
  new URL("../../../../../../../.tmp/host-browser-upload-fixtures/", import.meta.url),
);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(await realpath(scratch), await realpath(root));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Upload fixture escaped its scratch root.");
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  await mkdir(scratch, { recursive: true });
  const parent = await mkdtemp(path.join(scratch, "fixture-"));
  roots.push(parent);
  const root = path.join(parent, "workspace"),
    peer = path.join(parent, "peer");
  await mkdir(root);
  await mkdir(peer);
  await writeFile(path.join(root, "safe.txt"), "fixture");
  await writeFile(path.join(peer, "private.txt"), "peer fixture");
  return { parent, root, peer };
}
test("uploads resolve real regular files under the owning workspace", async () => {
  const f = await fixture();
  expect(await hostUploadFiles(f.root, ["safe.txt"])).toEqual([
    await realpath(path.join(f.root, "safe.txt")),
  ]);
  await expect(hostUploadFiles(f.root, ["."])).rejects.toThrow("regular files");
  await expect(hostUploadFiles(f.root, [])).rejects.toThrow("64");
});
test("lexical and linked escapes cannot upload a peer workspace's files", async () => {
  const f = await fixture();
  await expect(hostUploadFiles(f.root, ["../peer/private.txt"])).rejects.toThrow("workspace");
  await symlink(
    f.peer,
    path.join(f.root, "alias"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(hostUploadFiles(f.root, ["alias/private.txt"])).rejects.toThrow("workspace");
});
