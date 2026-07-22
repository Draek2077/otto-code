import { describe, expect, test } from "vitest";

import {
  READ_TOOL_NAMES,
  WRITE_TOOL_NAMES,
  codexSandboxModeForAccess,
  deniedToolsForAccess,
  describeUnsupportedAccess,
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

  test("the shell is denied only at none — read still allows checks", () => {
    // "read" exists for reviewer nodes that run tests and git queries; denying
    // Bash there would make the level useless for its main purpose.
    expect(deniedToolsForAccess("read")).not.toContain("Bash");
    expect(deniedToolsForAccess("none")).toContain("Bash");
  });
});

describe("codexSandboxModeForAccess", () => {
  test("write leaves the seat's own preset alone", () => {
    expect(codexSandboxModeForAccess("write")).toBeNull();
  });

  test("read and none both map onto Codex's read-only tier", () => {
    expect(codexSandboxModeForAccess("read")).toBe("read-only");
    expect(codexSandboxModeForAccess("none")).toBe("read-only");
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
});
