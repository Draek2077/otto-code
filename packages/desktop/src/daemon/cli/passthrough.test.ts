import { afterEach, describe, expect, it, vi } from "vitest";
import {
  launchPassthroughCli,
  parsePassthroughCliArgs,
  parsePassthroughCliArgsFromArgv,
  runPassthroughCli,
} from "./passthrough";

const originalDefaultApp = process.defaultApp;
const originalDesktopCli = process.env.OTTO_DESKTOP_CLI;

function setDefaultApp(value: boolean): void {
  Object.defineProperty(process, "defaultApp", {
    configurable: true,
    value,
  });
}

describe("passthrough CLI", () => {
  afterEach(() => {
    setDefaultApp(originalDefaultApp);
    if (originalDesktopCli === undefined) {
      delete process.env.OTTO_DESKTOP_CLI;
    } else {
      process.env.OTTO_DESKTOP_CLI = originalDesktopCli;
    }
  });

  it("returns null when no CLI args are provided", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/Applications/Otto.app/Contents/MacOS/Otto"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toBeNull();
  });

  it("ignores macOS GUI launch arguments", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/Applications/Otto.app/Contents/MacOS/Otto", "-psn_0_12345"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toBeNull();
  });

  it("ignores --no-sandbox injected by Linux wrapper", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/usr/bin/Otto", "--no-sandbox", "status"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toEqual(["status"]);
  });

  it("returns null when only --no-sandbox is present", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/usr/bin/Otto", "--no-sandbox"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toBeNull();
  });

  it("ignores Linux desktop identity arguments injected by the Nix wrapper", () => {
    expect(
      parsePassthroughCliArgs({
        argv: [
          "/nix/store/electron/bin/electron",
          "/nix/store/paseo-desktop/share/paseo-desktop/electron-app",
          "--no-sandbox",
          "--class=paseo-desktop",
          "daemon",
          "status",
        ],
        isDefaultApp: true,
        forceCli: false,
      }),
    ).toEqual(["daemon", "status"]);
  });

  it("ignores Electron remote debugging switches", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/usr/bin/Otto", "--remote-debugging-port=9233"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toBeNull();
  });

  it("ignores GPU rendering escape-hatch switches", () => {
    expect(
      parsePassthroughCliArgs({
        argv: [
          "/usr/bin/Otto",
          "--ozone-platform=x11",
          "--use-gl=angle",
          "--use-angle=swiftshader",
        ],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toBeNull();
  });

  it("ignores --updated from the Windows installer's post-install relaunch", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["C:\\Users\\me\\AppData\\Local\\Programs\\Otto\\Otto.exe", "--updated"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toBeNull();
  });

  it("preserves CLI flags for direct app invocations", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/Applications/Otto.app/Contents/MacOS/Otto", "--version"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toEqual(["--version"]);
  });

  it("passes --open-project through as a normal CLI arg", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/Applications/Otto.app/Contents/MacOS/Otto", "--open-project", "/tmp/project"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toEqual(["--open-project", "/tmp/project"]);
  });

  it("forces CLI mode for shim launches even without args", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/Applications/Otto.app/Contents/MacOS/Otto"],
        isDefaultApp: false,
        forceCli: true,
      }),
    ).toEqual([]);
  });

  it("parses terminal args for direct app CLI passthrough", () => {
    setDefaultApp(false);
    delete process.env.OTTO_DESKTOP_CLI;

    expect(
      parsePassthroughCliArgsFromArgv([
        "/Applications/Otto.app/Contents/MacOS/Otto",
        "daemon",
        "set-password",
      ]),
    ).toEqual(["daemon", "set-password"]);
  });

  it("runs passthrough CLI as a child process and reports its exit code", async () => {
    const invocation = {
      command: "/opt/Otto/Otto",
      args: ["--disable-warning=DEP0040", "/runner.js", "node-script", "/cli.js", "daemon"],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    };
    const build = vi.fn(() => invocation);
    const launch = vi.fn(async () => 7);

    await expect(runPassthroughCli(["daemon", "set-password"], { build, launch })).resolves.toBe(7);

    expect(build).toHaveBeenCalledWith(["daemon", "set-password"]);
    expect(launch).toHaveBeenCalledWith(invocation);
  });

  // The bug this replaced: the CLI ran inside the Electron main process, which
  // quits as soon as the command's promise resolves and never waits on open
  // handles - so `otto brain serve` printed "ready" and died seconds later.
  it("stays with a child that holds an open handle until it exits", async () => {
    const code = await launchPassthroughCli({
      command: process.execPath,
      args: [
        "-e",
        "const s = require('net').createServer().listen(0);" +
          "setTimeout(() => { s.close(); process.exit(4); }, 150);",
      ],
      env: process.env,
    });

    expect(code).toBe(4);
  });
});
