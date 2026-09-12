import { describe, expect, test } from "vitest";
import { isOttoToolReadOnly, ottoToolPermissionKind } from "./otto-tool-permissions.js";

describe("Otto tool permission classification", () => {
  test.each(["list_workspaces", "read_project_knowledge", "get_chat_status", "wait_for_chats"])(
    "%s is an observation, independent of provider",
    (name) => {
      expect(ottoToolPermissionKind(name)).toBe("read");
      expect(isOttoToolReadOnly(name)).toBe(true);
    },
  );
  test.each([
    "archive_workspace",
    "create_terminal",
    "send_terminal_keys",
    "set_chat_mode",
    "unknown_tool",
  ])("%s cannot inherit read preapproval", (name) => {
    expect(ottoToolPermissionKind(name)).toBe("execute");
    expect(isOttoToolReadOnly(name)).toBe(false);
  });
  test.each(["speak", "suggest_task", "dismiss_task"])(
    "%s keeps its UI exemption without advertising a false read-only hint",
    (name) => {
      expect(ottoToolPermissionKind(name)).toBe("read");
      expect(isOttoToolReadOnly(name)).toBe(false);
    },
  );
});
