import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeExplorerBinaryFile, writeExplorerFile } from "./service.js";

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

// A minimal real PDF header. The point is that these bytes are not text: the
// null byte is what `writeExplorerFile` reads as "binary" and refuses.
const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x00, 0x0a]);

describe("writeExplorerBinaryFile", () => {
  it("writes bytes verbatim, with no EOL translation", async () => {
    const root = await createTempDir("otto-binary-write-");
    try {
      const bytes = Buffer.from([0x00, 0x0a, 0x0d, 0x0a, 0xff]);
      // A nested path also proves the parent directory is created, which both
      // branches of the write have to agree on.
      const result = await writeExplorerBinaryFile({
        root,
        relativePath: "out/report.pdf",
        bytes,
      });

      expect(result).toMatchObject({ status: "written", size: bytes.length });
      // A CRLF host must not have turned the lone LF into CRLF on the way out.
      expect(await readFile(path.join(root, "out", "report.pdf"))).toEqual(bytes);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses an existing target unless asked to overwrite", async () => {
    const root = await createTempDir("otto-binary-write-");
    try {
      await writeFile(path.join(root, "report.pdf"), "original", "utf8");

      const refused = await writeExplorerBinaryFile({
        root,
        relativePath: "report.pdf",
        bytes: PDF_BYTES,
      });

      expect(refused).toEqual({ status: "exists" });
      expect(await readFile(path.join(root, "report.pdf"), "utf8")).toBe("original");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("replaces an existing binary file — the case the text write refuses outright", async () => {
    const root = await createTempDir("otto-binary-write-");
    try {
      await writeExplorerBinaryFile({ root, relativePath: "report.pdf", bytes: PDF_BYTES });

      // The re-export case. Through the text write this is not a conflict to
      // resolve, it is a hard refusal, which is why the binary RPC exists.
      const current = await stat(path.join(root, "report.pdf"));
      await expect(
        writeExplorerFile({
          root,
          relativePath: "report.pdf",
          content: "replacement",
          expectedModifiedAt: current.mtime.toISOString(),
        }),
      ).rejects.toThrow(/binary/i);

      const replacement = Buffer.concat([PDF_BYTES, Buffer.from([0x01, 0x02])]);
      const result = await writeExplorerBinaryFile({
        root,
        relativePath: "report.pdf",
        bytes: replacement,
        overwrite: true,
      });

      expect(result.status).toBe("written");
      expect(await readFile(path.join(root, "report.pdf"))).toEqual(replacement);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to escape the workspace root", async () => {
    const root = await createTempDir("otto-binary-write-");
    try {
      await expect(
        writeExplorerBinaryFile({
          root,
          relativePath: "../escaped.pdf",
          bytes: PDF_BYTES,
        }),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
