import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { EditorImageWrites } from "./images.js";
const live = () => true;
const released = () => false;
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHBkAAAAASUVORK5CYII=";
async function fixture() {
  const base = path.resolve("../../.tmp/editor-image-fixtures");
  await mkdir(base, { recursive: true });
  const owned = await mkdtemp(path.join(base, "paste-"));
  const root = path.join(owned, "workspace");
  await mkdir(root);
  const file = path.join(root, "readme.md");
  await writeFile(file, "# Document\n");
  return {
    owned,
    root,
    file,
    host: new EditorImageWrites(),
    request: {
      hostId: "host",
      root,
      file,
      operationId: randomUUID(),
      image: { name: "../../../screen.png", mimeType: "image/png", dataBase64: png },
    },
  };
}
describe("Markdown assets on the selected host", () => {
  it("creates rather than overwrites, and recovers a repeated operation without creating a second asset", async () => {
    const f = await fixture();
    try {
      const first = await f.host.write("client", f.request, live);
      expect(await readFile(path.join(f.root, first.path))).toEqual(Buffer.from(png, "base64"));
      expect(first.insert).toContain("assets/");
      expect(await f.host.write("client", f.request, live)).toEqual(first);
      expect(await readdir(path.join(f.root, "assets"))).toHaveLength(1);
      expect(() =>
        f.host.write(
          "client",
          { ...f.request, image: { ...f.request.image, name: "different.png" } },
          live,
        ),
      ).toThrow("different bytes");
      await f.host.write("client", { ...f.request, operationId: randomUUID() }, live);
      expect(await readdir(path.join(f.root, "assets"))).toHaveLength(2);
      expect(await readFile(f.file, "utf8")).toBe("# Document\n");
    } finally {
      await rm(f.owned, { recursive: true, force: true });
    }
  });
  it("refuses malformed images and released demand without writing an asset", async () => {
    const f = await fixture();
    try {
      await expect(
        f.host.write(
          "client",
          { ...f.request, image: { ...f.request.image, dataBase64: "%%%" } },
          live,
        ),
      ).rejects.toThrow("decoded");
      await expect(
        f.host.write("client", { ...f.request, operationId: randomUUID() }, released),
      ).rejects.toThrow("closed");
      expect(await readdir(f.root)).toEqual(["readme.md"]);
    } finally {
      await rm(f.owned, { recursive: true, force: true });
    }
  });
  it("rejects an assets junction/symlink that leaves the workspace", async () => {
    const f = await fixture();
    try {
      const outside = path.join(f.owned, "outside");
      await mkdir(outside);
      await symlink(
        outside,
        path.join(f.root, "assets"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await expect(f.host.write("client", f.request, live)).rejects.toThrow("leaves");
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(f.owned, { recursive: true, force: true });
    }
  });
});
