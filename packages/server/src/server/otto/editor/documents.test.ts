import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { EditorDocuments } from "./documents.js";
import { fileUri } from "./lsp/uri.js";
import type { EditorDocument } from "@getpaseo/plugin/otto/editor";

function fixture() {
  const close = vi.fn(async () => undefined);
  const docs = new EditorDocuments({
    closeDocument: close,
    onError: (error) => {
      throw error;
    },
  });
  const root = path.resolve("../../.tmp/editor-lease-fixture");
  const document: EditorDocument = {
    hostId: "host",
    root,
    file: path.join(root, "file.ts"),
    text: "first draft",
    draftVersion: 0,
    modified: true,
    documentId: "editor",
  };
  return { docs, document, close };
}
describe("active editor draft leases", () => {
  it("keeps peer drafts separate and closes the language document only after its last consumer", async () => {
    const f = fixture();
    try {
      f.docs.sync("first", f.document);
      f.docs.sync("peer", { ...f.document, text: "second draft" });
      expect(() => f.docs.sync("first", { ...f.document, text: "different bytes" })).toThrow(
        "revision",
      );
      f.docs.publish(
        f.document.root,
        "typescript",
        {
          uri: fileUri(f.document.file),
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
              message: "first only",
            },
          ],
        },
        "first draft",
      );
      expect((await f.docs.observe("first", "editor", null, () => [])).diagnostics).toHaveLength(1);
      expect((await f.docs.observe("peer", "editor", null, () => [])).diagnostics).toHaveLength(0);
      await f.docs.releaseClient("first");
      expect(f.close).not.toHaveBeenCalled();
      expect(f.docs.drafts(f.document.root, f.document.file)).toEqual(["second draft"]);
      await f.docs.releaseClient("peer");
      expect(f.close).toHaveBeenCalledTimes(1);
    } finally {
      await f.docs.close();
    }
  });
  it("releases an outstanding long wait and does not keep clean observations as rename blockers", async () => {
    const f = fixture();
    try {
      f.docs.sync("client", { ...f.document, modified: false });
      expect(f.docs.drafts(f.document.root, f.document.file)).toEqual([]);
      const first = await f.docs.observe("client", "editor", null, () => []);
      const waiting = f.docs
        .observe("client", "editor", first.cursor, () => [])
        .catch((error: unknown) => error);
      await f.docs.releaseWorkspace(f.document.root);
      expect(await waiting).toMatchObject({ kind: "closed" });
    } finally {
      await f.docs.close();
    }
  });
  it("bounds retained draft bytes across otherwise valid document identities", async () => {
    const f = fixture();
    try {
      const text = "x".repeat(2 * 1024 * 1024);
      for (let index = 0; index < 8; index++)
        f.docs.sync("client", { ...f.document, documentId: String(index), text });
      expect(() =>
        f.docs.sync("client", { ...f.document, documentId: "over-budget", text }),
      ).toThrow("budget");
      await f.docs.releaseDocument("client", "0");
      expect(() =>
        f.docs.sync("client", { ...f.document, documentId: "now-fits", text }),
      ).not.toThrow();
    } finally {
      await f.docs.close();
    }
  });
});
