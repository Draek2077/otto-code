import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { resolveDeleteEntryDialog, resolveDeleteFolderContentsDialog } from "./mutation-dialogs";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("resolveDeleteEntryDialog", () => {
  it("is destructive and names the entry", () => {
    const dialog = resolveDeleteEntryDialog({ name: "notes.md", kind: "file" });
    expect(dialog.destructive).toBe(true);
    expect(dialog.confirmLabel).toBe("Delete");
    expect(dialog.message).toContain('"notes.md"');
  });

  it("says the delete is permanent and not a move to the trash", () => {
    const dialog = resolveDeleteEntryDialog({ name: "notes.md", kind: "file" });
    expect(dialog.message).toContain("permanent");
    expect(dialog.message).toContain("not moved to the trash");
    expect(dialog.message).toContain("Otto cannot undo it");
  });

  it("distinguishes a folder from a file in the title", () => {
    expect(resolveDeleteEntryDialog({ name: "src", kind: "directory" }).title).toBe(
      "Delete folder?",
    );
    expect(resolveDeleteEntryDialog({ name: "a.ts", kind: "file" }).title).toBe("Delete file?");
  });

  // The whole point of translating destructive copy: consent to an irreversible
  // action whose wording you could not read is not consent (docs/i18n.md).
  it("is translated, not English, in another locale", async () => {
    await i18n.changeLanguage("fr");
    const dialog = resolveDeleteEntryDialog({ name: "notes.md", kind: "file" });
    expect(dialog.title).toBe("Supprimer le fichier ?");
    expect(dialog.confirmLabel).toBe("Supprimer");
    expect(dialog.message).toContain("notes.md");
  });
});

describe("resolveDeleteFolderContentsDialog", () => {
  it("warns that the contents go too, and stays destructive", () => {
    const dialog = resolveDeleteFolderContentsDialog({ name: "src" });
    expect(dialog.destructive).toBe(true);
    expect(dialog.title).toBe("Delete folder and its contents?");
    expect(dialog.message).toContain('"src" is not empty');
    expect(dialog.message).toContain("Everything inside it will be deleted too");
  });

  it("repeats the permanence disclosure rather than assuming the first dialog was read", () => {
    const dialog = resolveDeleteFolderContentsDialog({ name: "src" });
    expect(dialog.message).toContain("not moved to the trash");
  });
});
