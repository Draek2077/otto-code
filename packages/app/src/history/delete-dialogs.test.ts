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
    expect(dialog.message).toMatch(/still be read or resumed\./);
  });

  it("states that deleting the chat cannot be undone", () => {
    const dialog = resolveDeleteAgentDialog({ title: "x", provider: "claude" });
    expect(dialog.message).toContain("This change cannot be undone.");
  });

  it("falls back to a generic subject for an untitled chat", () => {
    for (const title of [null, undefined, "", "   "]) {
      const dialog = resolveDeleteAgentDialog({ title, provider: "codex" });
      expect(dialog.message).toContain("The record for this chat will be deleted permanently");
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
    const dialog = resolveClearArchivedDialog({ matched: 1, scope: "oneHost" });
    expect(dialog.title).toBe("Clear 1 archived chat?");
    expect(dialog.message).toContain("1 archived chat on this host.");
  });

  it("uses plural copy and the real count for many", () => {
    const dialog = resolveClearArchivedDialog({ matched: 143, scope: "oneHost" });
    expect(dialog.title).toBe("Clear 143 archived chats?");
    expect(dialog.message).toContain("143 archived chats on this host.");
  });

  it("promises active chats are untouched", () => {
    const dialog = resolveClearArchivedDialog({ matched: 5, scope: "oneHost" });
    expect(dialog.message).toContain("Active chats are not affected.");
  });

  it("repeats the provider-transcript disclosure - bulk is not a back door", () => {
    const dialog = resolveClearArchivedDialog({ matched: 5, scope: "oneHost" });
    expect(dialog.message).toContain("Provider transcripts remain on the host.");
  });

  it("is destructive", () => {
    const dialog = resolveClearArchivedDialog({ matched: 5, scope: "oneHost" });
    expect(dialog.destructive).toBe(true);
    expect(dialog.confirmLabel).toBe("Clear");
    expect(dialog.checkboxLabel).toBeUndefined();
  });

  it("states when the All hosts selection affects every host", () => {
    const dialog = resolveClearArchivedDialog({ matched: 5, scope: "allHosts" });
    expect(dialog.message).toContain("5 archived chats across all hosts.");
    expect(dialog.message).toContain("Provider transcripts remain on the hosts.");
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
    const dialog = resolveClearArchivedDialog({ matched: 5, scope: "oneHost" });

    expect(dialog.title).toBe("清空 5 个已归档对话？");
    expect(dialog.confirmLabel).toBe("清空");
    expect(dialog.message).toContain("5");
  });
});
