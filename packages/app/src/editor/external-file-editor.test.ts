import { describe, expect, it } from "vitest";
import type { TerminalCompatibilityDiagnosticResponse } from "@otto-code/protocol/messages";
import {
  parseExternalEditorCommand,
  resolveExternalEditorCapability,
  resolveExternalFileEditorCommand,
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
      args: ["README.md"],
    });
    expect(
      resolveExternalFileEditorCommand({ mode: "neovim", customCommand: "", path: "README.md" }),
    ).toEqual({
      command: "nvim",
      args: ["README.md"],
    });
    expect(
      resolveExternalFileEditorCommand({ mode: "off", customCommand: "vim", path: "README.md" }),
    ).toBeNull();
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
});
