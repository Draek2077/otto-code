import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { resolveClearArchivedDialog, resolveDeleteAgentDialog } from "./delete-dialogs";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("history delete dialogs", () => {
  it("quotes the chat title and has no provider cleanup option", () => {
    const dialog = resolveDeleteAgentDialog({ title: "Fix the parser" });
    expect(dialog.destructive).toBe(true);
    expect(dialog.confirmLabel).toBe("Delete");
    expect(dialog.message).toContain('"Fix the parser"');
    expect(dialog.checkboxLabel).toBeUndefined();
  });

  it("uses singular and plural bulk copy", () => {
    expect(resolveClearArchivedDialog({ matched: 1, scope: "oneHost" }).title).toBe(
      "Clear 1 archived chat?",
    );
    expect(resolveClearArchivedDialog({ matched: 143, scope: "oneHost" }).title).toBe(
      "Clear 143 archived chats?",
    );
  });
});
