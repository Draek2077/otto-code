import { describe, expect, it } from "vitest";
import type { TerminalCompatibilityDiagnosticResponse } from "@otto-code/protocol/messages";
import {
  parseExternalEditorCommand,
  buildExternalFileEditorPresentationOwner,
  hasActiveExternalFileEditor,
  registerActiveExternalFileEditor,
  resolveExternalEditorCapability,
  resolveExternalFileEditorCommand,
  shouldOpenInSelectedFileEditor,
} from "./external-file-editor";

describe("external file editor commands", () => {
  it("parses a custom command without shell expansion", () => {
    expect(parseExternalEditorCommand('code --wait "my project"')).toEqual([
      "code",
      "--wait",
      "my project",
    ]);
    expect(
      resolveExternalFileEditorCommand({
        mode: "custom",
        customCommand: "code --wait",
        path: "src/app.ts",
      }),
    ).toEqual({
      command: "code",
      args: ["--wait", "src/app.ts"],
    });
  });

  it("resolves the standard editors and keeps Off disabled", () => {
    expect(
      resolveExternalFileEditorCommand({ mode: "vim", customCommand: "", path: "README.md" }),
    ).toEqual({
      command: "vim",
      args: ["--", "README.md"],
    });
    expect(
      resolveExternalFileEditorCommand({ mode: "neovim", customCommand: "", path: "README.md" }),
    ).toEqual({
      command: "nvim",
      args: ["--", "README.md"],
    });
    expect(
      resolveExternalFileEditorCommand({ mode: "off", customCommand: "vim", path: "README.md" }),
    ).toBeNull();
  });

  it("terminates Vim option parsing before an untrusted file path", () => {
    expect(
      resolveExternalFileEditorCommand({ mode: "vim", customCommand: "", path: "+quit" }),
    ).toEqual({ command: "vim", args: ["--", "+quit"] });
  });

  it("tracks active sessions by their stable renderer-independent owner", () => {
    const identity = {
      serverId: "host-a",
      workspaceId: "workspace-a",
      path: "src/app.ts",
    };
    const owner = buildExternalFileEditorPresentationOwner({
      workspaceId: identity.workspaceId,
      absolutePath: "/repo/src/app.ts",
    });
    expect(owner).toContain("workspace-a");
    expect(hasActiveExternalFileEditor(identity)).toBe(false);
    const unregister = registerActiveExternalFileEditor(identity);
    expect(hasActiveExternalFileEditor(identity)).toBe(true);
    unregister();
    expect(hasActiveExternalFileEditor(identity)).toBe(false);
  });

  it("requires a passing host executable check", () => {
    const payload = (
      status: "pass" | "fail",
    ): TerminalCompatibilityDiagnosticResponse["payload"] => ({
      requestId: "test",
      success: status === "pass",
      error: null,
      generatedAt: "test",
      checks: [{ id: "vim", label: "Vim", status, detail: "" }],
    });
    expect(resolveExternalEditorCapability(payload("pass"), "vim")).toBeNull();
    expect(resolveExternalEditorCapability(payload("fail"), "vim")).toContain("not available");
  });

  it("keeps Markdown in Otto when configured", () => {
    expect(
      shouldOpenInSelectedFileEditor({
        path: "README.md",
        defaultViewIsEditor: false,
        renderedDocument: true,
        alwaysUseOttoEditorForMarkdown: true,
      }),
    ).toBe(false);
  });

  it("still opens other source and rendered documents in the selected editor", () => {
    expect(
      shouldOpenInSelectedFileEditor({
        path: "src/main.ts",
        defaultViewIsEditor: true,
        renderedDocument: false,
        alwaysUseOttoEditorForMarkdown: true,
      }),
    ).toBe(true);
    expect(
      shouldOpenInSelectedFileEditor({
        path: "guide.MD",
        defaultViewIsEditor: false,
        renderedDocument: true,
        alwaysUseOttoEditorForMarkdown: false,
      }),
    ).toBe(true);
  });
});
