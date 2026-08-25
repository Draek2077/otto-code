import { describe, expect, test } from "vitest";

import {
  OTTO_EXECUTE_TOOL_NAMES,
  OTTO_NONE_ALLOWED_TOOL_NAMES,
  READ_TOOL_NAMES,
  WRITE_TOOL_NAMES,
  capabilitiesEnforceAccess,
  codexSandboxModeForAccess,
  deniedToolsForAccess,
  describeUnsupportedAccess,
  isOttoToolAllowedForAccess,
  ottoToolsDeniedForAccess,
  resolveWorkspaceAccess,
} from "./workspace-access.js";

describe("resolveWorkspaceAccess", () => {
  test("absent means write, so nothing that predates the feature changes", () => {
    expect(resolveWorkspaceAccess(undefined)).toBe("write");
  });

  test("an unrecognised value falls back to write rather than half-restricting", () => {
    // A level we can't interpret must not silently become a *different*
    // restriction; the compile-time check is what refuses unsupported setups.
    expect(resolveWorkspaceAccess("sandbox")).toBe("write");
  });

  test("known levels pass through", () => {
    expect(resolveWorkspaceAccess("none")).toBe("none");
    expect(resolveWorkspaceAccess("read")).toBe("read");
  });
});

describe("deniedToolsForAccess", () => {
  test("write denies nothing", () => {
    expect(deniedToolsForAccess("write")).toEqual([]);
  });

  test("read denies every write tool and keeps the read tools", () => {
    const denied = deniedToolsForAccess("read");
    for (const tool of WRITE_TOOL_NAMES) {
      expect(denied).toContain(tool);
    }
    for (const tool of READ_TOOL_NAMES) {
      expect(denied).not.toContain(tool);
    }
  });

  test("none denies reads and shells as well", () => {
    const denied = deniedToolsForAccess("none");
    for (const tool of [...WRITE_TOOL_NAMES, ...READ_TOOL_NAMES]) {
      expect(denied).toContain(tool);
    }
  });

  test("the shell is denied only at none - read still allows checks", () => {
    // "read" exists for reviewer nodes that run tests and git queries; denying
    // Bash there would make the level useless for its main purpose.
    expect(deniedToolsForAccess("read")).not.toContain("Bash");
    expect(deniedToolsForAccess("none")).toContain("Bash");
  });
});

describe("isOttoToolAllowedForAccess", () => {
  test("write allows the whole catalog", () => {
    for (const tool of ["create_terminal", "browser_upload", "create_worktree", "create_chat"]) {
      expect(isOttoToolAllowedForAccess(tool, "write")).toBe(true);
    }
  });

  test("read denies the execute surface and keeps everything else", () => {
    for (const tool of OTTO_EXECUTE_TOOL_NAMES) {
      expect(isOttoToolAllowedForAccess(tool, "read")).toBe(false);
    }
    // The tier bounds tools; observation and the below-none mutators stay.
    for (const tool of [
      "capture_terminal",
      "create_worktree",
      "create_artifact",
      "browser_click",
    ]) {
      expect(isOttoToolAllowedForAccess(tool, "read")).toBe(true);
    }
  });

  test("none denies every workspace-shaped group", () => {
    for (const tool of [
      ...OTTO_EXECUTE_TOOL_NAMES,
      "list_terminals",
      "capture_terminal",
      "create_worktree",
      "archive_worktree",
      "create_workspace",
      "archive_workspace",
      "rename_workspace",
      "create_artifact",
      "update_artifact",
      "generate_artifact",
      "preview_start",
      "preview_stop",
    ]) {
      expect(isOttoToolAllowedForAccess(tool, "none")).toBe(false);
    }
  });

  test("none keeps the orchestration axis and daemon-state observation", () => {
    // A reviewer node declared "none" still reports, coordinates, and verifies
    // a rendered page against an already-running dev server.
    for (const tool of [
      "create_chat",
      "send_chat_prompt",
      "wait_for_chats",
      "submit_output",
      "speak",
      "browser_snapshot",
      "browser_click",
      ...OTTO_NONE_ALLOWED_TOOL_NAMES,
    ]) {
      expect(isOttoToolAllowedForAccess(tool, "none")).toBe(true);
    }
  });

  test("a NEW tool in a workspace-shaped group is denied at none by default", () => {
    // Default-deny: these names are listed nowhere - the group rule catches
    // them, so a future catalog tool cannot silently bypass the ceiling.
    for (const tool of ["purge_terminal_buffers", "sync_worktree", "delete_artifact"]) {
      expect(isOttoToolAllowedForAccess(tool, "none")).toBe(false);
      // ...while read only bounds the explicit execute surface.
      expect(isOttoToolAllowedForAccess(tool, "read")).toBe(true);
    }
  });

  test("every namespaced form a provider sees is matched", () => {
    expect(isOttoToolAllowedForAccess("mcp__otto__create_terminal", "read")).toBe(false);
    expect(isOttoToolAllowedForAccess("mcp__otto_agent__send_terminal_keys", "read")).toBe(false);
    expect(isOttoToolAllowedForAccess("otto.browser_upload", "read")).toBe(false);
    expect(isOttoToolAllowedForAccess("mcp__otto__create_worktree", "none")).toBe(false);
  });

  test("non-Otto MCP tools are another server's business", () => {
    expect(isOttoToolAllowedForAccess("mcp__linear__create_issue", "none")).toBe(true);
  });
});

describe("ottoToolsDeniedForAccess", () => {
  test("write denies nothing", () => {
    expect(ottoToolsDeniedForAccess("write")).toEqual([]);
  });

  test("the static lists and the predicate agree, so the two layers cannot drift", () => {
    for (const access of ["read", "none"] as const) {
      for (const tool of ottoToolsDeniedForAccess(access)) {
        expect(isOttoToolAllowedForAccess(tool, access)).toBe(false);
      }
    }
    // And read's denials are a subset of none's: the tiers only ever narrow.
    const noneDenied = new Set(ottoToolsDeniedForAccess("none"));
    for (const tool of ottoToolsDeniedForAccess("read")) {
      expect(noneDenied.has(tool)).toBe(true);
    }
  });
});

describe("codexSandboxModeForAccess", () => {
  test("write leaves the seat's own preset alone", () => {
    expect(codexSandboxModeForAccess("write")).toBeNull();
  });

  test("read maps onto Codex's read-only tier", () => {
    expect(codexSandboxModeForAccess("read")).toBe("read-only");
  });

  test("none falls back to the read-only floor - defense in depth, not the level", () => {
    // Codex cannot express "no filesystem", so the capability gate refuses
    // "none" on Codex seats before this mapping runs. If a config carries the
    // level anyway, the floor is the most the adapter can impose.
    expect(codexSandboxModeForAccess("none")).toBe("read-only");
  });
});

describe("capabilitiesEnforceAccess", () => {
  test("write needs no capability at all - it is today's behaviour", () => {
    expect(capabilitiesEnforceAccess(undefined, "write")).toBe(true);
    expect(capabilitiesEnforceAccess(null, "write")).toBe(true);
    expect(capabilitiesEnforceAccess({}, "write")).toBe(true);
  });

  test("read requires supportsWorkspaceAccess", () => {
    expect(capabilitiesEnforceAccess(undefined, "read")).toBe(false);
    expect(capabilitiesEnforceAccess({}, "read")).toBe(false);
    expect(capabilitiesEnforceAccess({ supportsWorkspaceAccess: true }, "read")).toBe(true);
  });

  test("none additionally requires supportsWorkspaceAccessNone - a read-only floor is not none", () => {
    // Codex's shape: sandbox tiers bound writes, but its shell reads freely
    // inside every tier and the protocol has no tool-deny list, so declaring
    // supportsWorkspaceAccess alone must not admit "none".
    expect(capabilitiesEnforceAccess({ supportsWorkspaceAccess: true }, "none")).toBe(false);
    expect(
      capabilitiesEnforceAccess(
        { supportsWorkspaceAccess: true, supportsWorkspaceAccessNone: true },
        "none",
      ),
    ).toBe(true);
  });

  test("the none flag alone grants nothing", () => {
    expect(capabilitiesEnforceAccess({ supportsWorkspaceAccessNone: true }, "none")).toBe(false);
    expect(capabilitiesEnforceAccess({ supportsWorkspaceAccessNone: true }, "read")).toBe(false);
  });
});

describe("describeUnsupportedAccess", () => {
  test("names the node, the level and the provider", () => {
    const message = describeUnsupportedAccess({
      nodeTitle: "Triage",
      access: "read",
      provider: "opencode",
    });
    expect(message).toContain("Triage");
    expect(message).toContain("read");
    expect(message).toContain("opencode");
  });

  test("a provider with a read floor names it and suggests read, not write", () => {
    const message = describeUnsupportedAccess({
      nodeTitle: "Triage",
      access: "none",
      provider: "codex",
      enforceableFloor: "read",
    });
    expect(message).toContain('"read" is its floor');
    expect(message).toContain('raise its access to "read"');
    expect(message).not.toContain('"write"');
  });
});
