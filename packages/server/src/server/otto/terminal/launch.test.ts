import { describe, expect, it } from "vitest";
import {
  terminalAutomaticTitle,
  terminalShellChoices,
  terminalShellOverride,
  terminalInitialTitle,
  terminalTitleMode,
} from "./launch.js";
import { alternateScreenPassed } from "./diagnostic.js";

describe("terminal policies", () => {
  it("preserves an explicit shell and command profile ahead of host preferences", async () => {
    const preferences = {
      terminalTitleMode: "default",
      terminalTitleIncludePaths: false,
      defaultTerminalShell: "powershell-7",
    } as const;
    expect(
      await terminalShellOverride({ shell: "/chosen/shell", ottoPreferences: preferences }),
    ).toBe("/chosen/shell");
    expect(
      await terminalShellOverride({ command: "/chosen/editor", ottoPreferences: preferences }),
    ).toBeUndefined();
  });
  it("keeps manual names verbatim and defaults stable without subscribing to OSC titles", () => {
    const preferences = {
      terminalTitleMode: "default",
      terminalTitleIncludePaths: false,
      defaultTerminalShell: "system",
    } as const;
    expect(terminalTitleMode("auto", preferences)).toBe("manual");
    expect(
      terminalInitialTitle({
        manual: "My /named terminal",
        initial: "My /named terminal",
        name: "Terminal 1",
        process: "/usr/bin/node file.js",
        preferences,
      }),
    ).toBe("My /named terminal");
    expect(
      terminalInitialTitle({
        manual: undefined,
        initial: "node file.js",
        name: "Terminal 1",
        process: "/usr/bin/node file.js",
        preferences,
      }),
    ).toBe("Terminal 1");
  });
  it.each([
    ["/home/phil/project/src/index.ts", "index.ts"],
    ["C:\\Users\\phil\\project\\main.ts", "main.ts"],
    ["node /home/phil/tool.js --watch", "node tool.js --watch"],
    ["vim", "vim"],
    ["vim src/editor.ts", "vim editor.ts"],
    ['nvim "C:\\Program Files\\project\\main.ts"', 'nvim "main.ts"'],
    ["  ", undefined],
  ])("hides paths in automatic title %s", (value, expected) =>
    expect(terminalAutomaticTitle(value, false)).toBe(expected),
  );
  it("retains complete paths only when requested", () =>
    expect(terminalAutomaticTitle(" C:\\Users\\phil\\project ", true)).toBe(
      "C:\\Users\\phil\\project",
    ));
  it("offers only system shell policy on POSIX hosts", async () =>
    expect(await terminalShellChoices("linux")).toEqual([
      { id: "system", label: "System default", available: true },
    ]));
  it("does not pass alternate-screen checks from concatenated output", () => {
    expect(alternateScreenPassed("OTTO_PRIMARY OTTO_ALT", "OTTO_PRIMARY OTTO_DONE")).toBe(false);
    expect(alternateScreenPassed("OTTO_ALT", "OTTO_PRIMARY OTTO_DONE OTTO_ALT")).toBe(false);
    expect(alternateScreenPassed("OTTO_ALT", "OTTO_PRIMARY OTTO_DONE")).toBe(true);
  });
});
