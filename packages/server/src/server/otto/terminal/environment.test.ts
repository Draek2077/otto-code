import { expect, it } from "vitest";
import { ottoTerminalEnvironment } from "./environment.js";
it("keeps Paseo identity while exposing the original Otto session names to user shell integrations", () => {
  const source = {
    PASEO_WORKSPACE_ID: "workspace",
    PASEO_TERMINAL_ID: "terminal",
    PASEO_ACTIVITY_TOKEN: "session-token",
    PASEO_HOOK_CLI: "/host/bin/otto",
    OTTO_WORKSPACE_ID: "parent-workspace",
    OTTO_CUSTOM: "user-setting",
  };
  expect(ottoTerminalEnvironment(source)).toEqual({
    ...source,
    OTTO_WORKSPACE_ID: "workspace",
    OTTO_TERMINAL_ID: "terminal",
    OTTO_ACTIVITY_TOKEN: "session-token",
    OTTO_HOOK_CLI: "/host/bin/otto",
  });
  expect(source.OTTO_WORKSPACE_ID).toBe("parent-workspace");
});
it("does not leak stale parent session metadata into an unrelated child session", () => {
  expect(
    ottoTerminalEnvironment({
      OTTO_WORKSPACE_ID: "parent",
      OTTO_ACTIVITY_TOKEN: "stale",
      OTTO_CUSTOM: "keep",
    }),
  ).toEqual({ OTTO_CUSTOM: "keep" });
});
