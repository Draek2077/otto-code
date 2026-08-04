import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import {
  resolveClearArchivedDialog,
  resolveClearArchivedEmptyDialog,
  resolveClearArchivedFailureDialog,
  resolveDeleteAgentDialog,
  resolveProviderDisplayName,
} from "./delete-dialogs";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("resolveProviderDisplayName", () => {
  it("names the providers Otto ships with", () => {
    expect(resolveProviderDisplayName("claude")).toBe("Claude Code");
    expect(resolveProviderDisplayName("codex")).toBe("Codex");
    expect(resolveProviderDisplayName("copilot")).toBe("GitHub Copilot");
    expect(resolveProviderDisplayName("opencode")).toBe("OpenCode");
    expect(resolveProviderDisplayName("pi")).toBe("Pi");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(resolveProviderDisplayName("  Claude ")).toBe("Claude Code");
  });

  it("falls back to neutral wording rather than inventing a name", () => {
    expect(resolveProviderDisplayName("some-acp-agent")).toBe("The agent provider");
    expect(resolveProviderDisplayName("")).toBe("The agent provider");
    expect(resolveProviderDisplayName(null)).toBe("The agent provider");
    expect(resolveProviderDisplayName(undefined)).toBe("The agent provider");
  });
});

describe("resolveDeleteAgentDialog", () => {
  it("is destructive and quotes the chat title", () => {
    const dialog = resolveDeleteAgentDialog({ title: "Fix the parser", provider: "claude" });
    expect(dialog.destructive).toBe(true);
    expect(dialog.confirmLabel).toBe("Delete");
    expect(dialog.message).toContain('"Fix the parser"');
  });

  it("discloses that the provider keeps its own transcript", () => {
    const dialog = resolveDeleteAgentDialog({ title: "x", provider: "claude" });
    expect(dialog.message).toContain("Claude Code's own transcript on the host is left in place");
    expect(dialog.message).toMatch(/still be read or resumed outside Otto/);
  });

  it("scopes the irreversibility claim to Otto's record", () => {
    const dialog = resolveDeleteAgentDialog({ title: "x", provider: "claude" });
    expect(dialog.message).toContain("Otto's side of this can't be undone.");
  });

  it("falls back to a generic subject for an untitled chat", () => {
    for (const title of [null, undefined, "", "   "]) {
      const dialog = resolveDeleteAgentDialog({ title, provider: "codex" });
      expect(dialog.message).toContain("Otto's record of this chat is deleted permanently");
      expect(dialog.message).not.toContain('""');
    }
  });

  it("never offers a checkbox - deleting provider data is not an option Otto exposes", () => {
    const dialog = resolveDeleteAgentDialog({ title: "x", provider: "claude" });
    expect(dialog.checkboxLabel).toBeUndefined();
    expect(dialog.alternateLabel).toBeUndefined();
  });
});

describe("resolveClearArchivedDialog", () => {
  it("uses singular copy for one match", () => {
    const dialog = resolveClearArchivedDialog({ matched: 1 });
    expect(dialog.title).toBe("Clear 1 archived chat?");
    expect(dialog.message).toContain("records for 1 archived chat.");
  });

  it("uses plural copy and the real count for many", () => {
    const dialog = resolveClearArchivedDialog({ matched: 143 });
    expect(dialog.title).toBe("Clear 143 archived chats?");
    expect(dialog.message).toContain("records for 143 archived chats.");
  });

  it("promises active chats are untouched", () => {
    const dialog = resolveClearArchivedDialog({ matched: 5 });
    expect(dialog.message).toContain("Chats you haven't archived are untouched.");
  });

  it("repeats the provider-transcript disclosure - bulk is not a back door", () => {
    const dialog = resolveClearArchivedDialog({ matched: 5 });
    expect(dialog.message).toContain(
      "The agent providers' own transcripts on the host are left in place",
    );
  });

  it("is destructive", () => {
    const dialog = resolveClearArchivedDialog({ matched: 5 });
    expect(dialog.destructive).toBe(true);
    expect(dialog.confirmLabel).toBe("Clear");
    expect(dialog.checkboxLabel).toBeUndefined();
  });
});

describe("outcome dialogs", () => {
  it("reports an empty sweep without a destructive confirm", () => {
    const dialog = resolveClearArchivedEmptyDialog();
    expect(dialog.title).toBe("Nothing to clear");
    expect(dialog.destructive).toBeUndefined();
  });

  it("reports a partial failure with both counts", () => {
    const dialog = resolveClearArchivedFailureDialog({ deleted: 12, failed: 3 });
    expect(dialog.message).toContain("Deleted 12.");
    expect(dialog.message).toContain("3 could not be deleted");
  });
});

// The destructive-delete copy is the last place a user should have to read a
// second language, so it follows the active locale like any other confirmation.
// Provider names stay as shipped - they are product names, not copy.
describe("active language", () => {
  it("translates the delete confirm while keeping the provider name", async () => {
    await i18n.changeLanguage("zh-CN");
    const dialog = resolveDeleteAgentDialog({ title: "Ship it", provider: "claude" });

    expect(dialog.title).toBe("删除此对话？");
    expect(dialog.confirmLabel).toBe("删除");
    expect(dialog.cancelLabel).toBe("取消");
    expect(dialog.message).toContain("Claude Code");
    expect(dialog.message).toContain('"Ship it"');
    expect(dialog.destructive).toBe(true);
  });

  it("translates the bulk clear and its counts", async () => {
    await i18n.changeLanguage("zh-CN");
    const dialog = resolveClearArchivedDialog({ matched: 5 });

    expect(dialog.title).toBe("清空 5 个已归档对话？");
    expect(dialog.confirmLabel).toBe("清空");
    expect(dialog.message).toContain("5");
  });
});
