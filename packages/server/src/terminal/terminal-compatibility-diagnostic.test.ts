import { describe, expect, it } from "vitest";
import {
  getPtyProbeLaunch,
  runTerminalCompatibilityDiagnostic,
} from "./terminal-compatibility-diagnostic.js";
import { createTerminalManager } from "./terminal-manager.js";

function checkById(
  result: Awaited<ReturnType<typeof runTerminalCompatibilityDiagnostic>>,
  id: string,
) {
  const check = result.checks.find((candidate) => candidate.id === id);
  if (!check) {
    throw new Error(`Missing diagnostic check ${id}`);
  }
  return check;
}

describe("terminal compatibility diagnostic", () => {
  it("uses PowerShell for the Windows PTY probe instead of Electron's executable", () => {
    expect(getPtyProbeLaunch("win32")).toEqual({
      command: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        expect.stringContaining("HALT_SCREEN_OK"),
      ],
    });
    expect(getPtyProbeLaunch("win32").args.at(-1)).toContain("Start-Sleep -Milliseconds 250");
  });

  it("reports tool, terminfo, color, and font evidence without claiming Kitty support", async () => {
    const result = await runTerminalCompatibilityDiagnostic(
      {
        terminalManager: null,
        platform: "linux",
        env: {
          TERM: "xterm-256color",
          TERM_PROGRAM: "kitty",
        },
        findExecutable: async (name) =>
          ["vim", "nvim", "tmux", "difft", "infocmp", "fc-match"].includes(name)
            ? `/usr/bin/${name}`
            : null,
        runCommand: async (_command, args) => {
          if (args[0] === "-f") {
            return { stdout: "Symbols Nerd Font\n", stderr: "" };
          }
          return { stdout: "Tc,\nsetrgbf,\n", stderr: "" };
        },
      },
      "request-1",
    );

    expect(result.success).toBe(true);
    expect(result.requestId).toBe("request-1");
    expect(checkById(result, "vim").status).toBe("pass");
    expect(checkById(result, "nvim").status).toBe("pass");
    expect(checkById(result, "tmux").status).toBe("pass");
    expect(checkById(result, "difft").status).toBe("pass");
    expect(checkById(result, "terminfo").status).toBe("pass");
    expect(checkById(result, "true-color").status).toBe("pass");
    expect(checkById(result, "nerd-font").status).toBe("pass");
    expect(checkById(result, "kitty-compatibility").status).toBe("unknown");
    expect(checkById(result, "kitty-compatibility").detail).toContain("TERM_PROGRAM alone");
  });

  it("keeps unavailable host probes explicit instead of treating them as failures", async () => {
    const result = await runTerminalCompatibilityDiagnostic(
      {
        terminalManager: null,
        platform: "win32",
        env: {},
        findExecutable: async () => null,
        runCommand: async () => ({ stdout: "", stderr: "" }),
      },
      "request-2",
    );

    expect(checkById(result, "vim").status).toBe("fail");
    expect(checkById(result, "terminfo").status).toBe("unknown");
    expect(checkById(result, "true-color").status).toBe("unknown");
    expect(checkById(result, "nerd-font").status).toBe("unknown");
    expect(checkById(result, "clipboard").status).toBe("unknown");
    expect(checkById(result, "mouse").status).toBe("unknown");
    expect(checkById(result, "pty-resize").status).toBe("unknown");
    expect(checkById(result, "terminal-restore").status).toBe("unknown");
  });

  it("uses the existing PTY manager for resize and alternate-screen checks", async () => {
    const terminalManager = createTerminalManager();
    try {
      const result = await runTerminalCompatibilityDiagnostic(
        {
          terminalManager,
          env: {},
          findExecutable: async () => null,
          runCommand: async () => ({ stdout: "", stderr: "" }),
        },
        "request-3",
      );

      expect(checkById(result, "pty-resize").status).toBe("pass");
      expect(checkById(result, "alternate-screen").status).toBe("pass");
      expect(checkById(result, "terminal-restore").status).toBe("warn");
    } finally {
      terminalManager.killAll();
    }
  });
});
