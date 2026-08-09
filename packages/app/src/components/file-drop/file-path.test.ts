import { describe, expect, it, vi } from "vitest";
import type { DesktopHostBridge } from "@/desktop/host";
import { getDroppedFilePath } from "./file-path";

function fakeFile(path?: string): File {
  const file = {} as File;
  if (path) Object.defineProperty(file, "path", { value: path });
  return file;
}

describe("getDroppedFilePath", () => {
  it("prefers Electron's supported webUtils path", () => {
    const getPathForFile = vi.fn(() => "/Users/me/Desktop/note.txt");
    const bridge: DesktopHostBridge = { webUtils: { getPathForFile } };
    const file = fakeFile("/legacy/note.txt");

    expect(getDroppedFilePath(file, bridge)).toBe("/Users/me/Desktop/note.txt");
    expect(getPathForFile).toHaveBeenCalledWith(file);
  });

  it("falls back to the legacy Electron File.path", () => {
    const bridge: DesktopHostBridge = {
      webUtils: {
        getPathForFile: vi.fn(() => {
          throw new Error("unavailable");
        }),
      },
    };

    expect(getDroppedFilePath(fakeFile("/legacy/note.txt"), bridge)).toBe("/legacy/note.txt");
  });

  it("does not claim a browser-only file has a host path", () => {
    expect(getDroppedFilePath(fakeFile(), null)).toBeNull();
  });
});
