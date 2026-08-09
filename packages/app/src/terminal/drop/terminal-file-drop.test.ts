import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { DesktopHostBridge } from "@/desktop/host";
import {
  extractTerminalDropPaths,
  isTerminalDragLeaveOutside,
  isTerminalFileDrag,
  prepareDroppedPathForTerminal,
  prepareDroppedPathsForTerminal,
} from "./terminal-file-drop";

function dataTransfer(input: { types?: string[]; files?: File[] }): DataTransfer {
  return {
    types: input.types ?? [],
    files: input.files ?? [],
  } as unknown as DataTransfer;
}

function fakeFile(input: { name: string; legacyPath?: string }): File {
  const file = { name: input.name } as unknown as File;
  if (input.legacyPath !== undefined) {
    Object.defineProperty(file, "path", {
      configurable: true,
      value: input.legacyPath,
    });
  }
  return file;
}

function makeNode(children: readonly EventTarget[] = []): EventTarget {
  return {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
    contains: (other: EventTarget | null) => other !== null && children.includes(other),
  } as unknown as EventTarget;
}

describe("terminal file drop", () => {
  it("detects file drags", () => {
    expect(isTerminalFileDrag(dataTransfer({ types: ["Files"] }))).toBe(true);
    expect(isTerminalFileDrag(dataTransfer({ types: ["text/plain"] }))).toBe(false);
    expect(isTerminalFileDrag(null)).toBe(false);
  });

  it("keeps drag highlight active when moving between terminal children", () => {
    const child = makeNode();
    const outside = makeNode();
    const root = makeNode([child]);

    expect(isTerminalDragLeaveOutside({ currentTarget: root, relatedTarget: child })).toBe(false);
    expect(isTerminalDragLeaveOutside({ currentTarget: root, relatedTarget: outside })).toBe(true);
    expect(isTerminalDragLeaveOutside({ currentTarget: root, relatedTarget: null })).toBe(true);
    expect(isTerminalDragLeaveOutside({ currentTarget: null, relatedTarget: child })).toBe(true);
  });

  it("extracts paths through Electron webUtils", () => {
    const file = fakeFile({ name: "photo.png" });
    const getPathForFile = vi.fn(() => "/Users/me/Desktop/photo.png");
    const bridge: DesktopHostBridge = { webUtils: { getPathForFile } };

    expect(
      extractTerminalDropPaths(dataTransfer({ types: ["Files"], files: [file] }), bridge),
    ).toEqual(["/Users/me/Desktop/photo.png"]);
    expect(getPathForFile).toHaveBeenCalledWith(file);
  });

  it("falls back to legacy Electron file paths", () => {
    const file = fakeFile({ name: "photo.png", legacyPath: "/tmp/legacy-photo.png" });
    const bridge: DesktopHostBridge = {
      webUtils: {
        getPathForFile: vi.fn(() => {
          throw new Error("not available");
        }),
      },
    };

    expect(
      extractTerminalDropPaths(dataTransfer({ types: ["Files"], files: [file] }), bridge),
    ).toEqual(["/tmp/legacy-photo.png"]);
  });

  it("drops browser files that have no filesystem path", () => {
    const file = fakeFile({ name: "photo.png" });

    expect(
      extractTerminalDropPaths(dataTransfer({ types: ["Files"], files: [file] }), null),
    ).toEqual([]);
  });

  it("preserves every POSIX path character while quoting", () => {
    const bridge: DesktopHostBridge = { platform: "darwin" };

    expect(prepareDroppedPathForTerminal("/tmp/my image.png", bridge)).toBe("'/tmp/my image.png'");
    expect(prepareDroppedPathForTerminal('/tmp/$& #~\\`|>!^*;<it\'s "quoted".png', bridge)).toBe(
      "'/tmp/$& #~\\`|>!^*;<it'\"'\"'s \"quoted\".png'",
    );
  });

  it.runIf(existsSync("/bin/sh"))("passes the original path as one POSIX shell argument", () => {
    const bridge: DesktopHostBridge = { platform: "darwin" };
    const path = '/tmp/$& #~\\`|>!^*;<it\'s "quoted".png';
    const quotedPath = prepareDroppedPathForTerminal(path, bridge);

    const result = execFileSync("/bin/sh", ["-c", `set -- ${quotedPath}; printf '%s' "$1"`], {
      encoding: "utf8",
    });

    expect(result).toBe(path);
  });

  it("prepares Windows paths with space quoting", () => {
    const bridge: DesktopHostBridge = { platform: "win32" };

    expect(prepareDroppedPathForTerminal("C:\\Users\\me\\photo.png", bridge)).toBe(
      "C:\\Users\\me\\photo.png",
    );
    expect(prepareDroppedPathForTerminal("C:\\Users\\me\\photo one.png", bridge)).toBe(
      '"C:\\Users\\me\\photo one.png"',
    );
  });

  it("joins multiple dropped paths for one terminal input", () => {
    const bridge: DesktopHostBridge = { platform: "darwin" };

    expect(prepareDroppedPathsForTerminal(["/tmp/a.png", "/tmp/b c.png"], bridge)).toBe(
      "'/tmp/a.png' '/tmp/b c.png'",
    );
  });
});
