import { expect, it } from "vitest";
import { speechArchiveCommand } from "./archive.js";

it("never gives GNU tar a Windows drive-prefixed archive name", () => {
  const result = speechArchiveCommand(
    "C:\\Speech models\\.downloads\\kokoro.tar.bz2",
    "C:\\Speech models\\extract",
    true,
  );
  expect(result).toEqual({
    args: ["xf", "kokoro.tar.bz2", "-C", "C:\\Speech models\\extract"],
    cwd: "C:\\Speech models\\.downloads",
  });
});
it("supports UNC archive locations without shell quoting or drive remapping", () => {
  const result = speechArchiveCommand(
    "\\\\host\\share\\voice models\\voice.tar.bz2",
    "\\\\host\\share\\extract",
    true,
  );
  expect(result.args[1]).toBe("voice.tar.bz2");
  expect(result.cwd).toBe("\\\\host\\share\\voice models");
});
it("refuses ambiguous relative paths before spawning an extractor", () => {
  expect(() => speechArchiveCommand("voice.tar.bz2", "C:\\extract", true)).toThrow("absolute");
});
