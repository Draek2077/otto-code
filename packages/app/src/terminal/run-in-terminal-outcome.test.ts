import { describe, expect, it } from "vitest";
import { resolveRunInTerminalOutcome } from "./run-in-terminal-outcome";

describe("resolveRunInTerminalOutcome", () => {
  it("opens the workspace with the new terminal focused", () => {
    expect(
      resolveRunInTerminalOutcome({
        serverId: "host-1",
        terminal: { id: "term-9", workspaceId: "ws-3" },
        error: null,
      }),
    ).toEqual({
      kind: "navigate",
      route: "/h/host-1/workspace/ws-3?open=terminal%3Aterm-9",
    });
  });

  it("falls back to a notice when the terminal has no workspace to open", () => {
    expect(
      resolveRunInTerminalOutcome({
        serverId: "host-1",
        terminal: { id: "term-9" },
        error: null,
      }),
    ).toEqual({ kind: "started" });
  });

  it("reports the daemon's error when no terminal was created", () => {
    expect(
      resolveRunInTerminalOutcome({
        serverId: "host-1",
        terminal: null,
        error: "spawn failed",
      }),
    ).toEqual({ kind: "error", message: "spawn failed" });
  });
});
