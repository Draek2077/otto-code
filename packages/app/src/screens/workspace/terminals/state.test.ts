import { describe, expect, it } from "vitest";
import {
  collectKnownTerminalIds,
  collectScriptTerminalIds,
  collectStandaloneTerminalIds,
  removeTerminalFromPayload,
  upsertCreatedTerminalPayload,
  type ListTerminalsPayload,
} from "@/screens/workspace/terminals/state";
import type { CreateTerminalResponse } from "@otto-code/protocol/messages";

function listedTerminal(id: string): ListTerminalsPayload["terminals"][number] {
  return { id, name: id, title: id };
}

function createdTerminal(id: string): NonNullable<CreateTerminalResponse["payload"]["terminal"]> {
  return { id, name: id, cwd: "/repo", title: id };
}

describe("workspace terminal state", () => {
  it("combines live and pending terminal ids without duplicating script terminals", () => {
    const pendingScriptTerminalIds = new Map([
      ["script-pending", 10],
      ["terminal-1", 10],
    ]);

    expect(
      collectKnownTerminalIds({
        liveTerminalIds: ["terminal-1", "terminal-2"],
        pendingScriptTerminalIds,
      }),
    ).toEqual(["terminal-1", "terminal-2", "script-pending"]);
    expect(
      collectScriptTerminalIds({
        pendingScriptTerminalIds,
        scripts: [{ terminalId: "script-live" }, { terminalId: null }],
      }),
    ).toEqual(new Set(["script-pending", "terminal-1", "script-live"]));
    expect(
      collectStandaloneTerminalIds({
        terminals: [
          listedTerminal("terminal-1"),
          listedTerminal("terminal-2"),
          listedTerminal("script-live"),
        ],
        scriptTerminalIds: new Set(["terminal-1", "script-live"]),
      }),
    ).toEqual(["terminal-2"]);
  });

  it("updates terminal cache entries for created and closed terminals", () => {
    const current: ListTerminalsPayload = {
      cwd: "/repo",
      requestId: "existing",
      terminals: [listedTerminal("terminal-1")],
    };

    expect(
      upsertCreatedTerminalPayload({
        current,
        terminal: createdTerminal("terminal-2"),
        workspaceDirectory: "/repo",
      }),
    ).toEqual({
      cwd: "/repo",
      requestId: "existing",
      terminals: [
        listedTerminal("terminal-1"),
        { id: "terminal-2", name: "terminal-2", title: "terminal-2" },
      ],
    });
    expect(removeTerminalFromPayload("terminal-1")(current)).toEqual({
      cwd: "/repo",
      requestId: "existing",
      terminals: [],
    });
  });
});
