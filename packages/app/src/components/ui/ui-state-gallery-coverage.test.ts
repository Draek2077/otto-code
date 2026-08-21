import { readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  UI_STATE_GALLERY_COVERED_FILES,
  UI_STATE_GALLERY_EXEMPTIONS,
} from "./ui-state-gallery-coverage";

const UI_DIRECTORY = dirname(fileURLToPath(import.meta.url));

function listVisualSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) return listVisualSourceFiles(absolute);
    if (!entry.name.endsWith(".tsx") || entry.name.endsWith(".test.tsx")) return [];
    return [relative(UI_DIRECTORY, absolute).split(sep).join("/")];
  });
}

describe("UI state gallery coverage", () => {
  it("accounts for every shared visual source file", () => {
    const accountedFor = new Set([
      ...UI_STATE_GALLERY_COVERED_FILES,
      ...Object.keys(UI_STATE_GALLERY_EXEMPTIONS),
    ]);
    const sourceFiles = listVisualSourceFiles(UI_DIRECTORY);
    expect(sourceFiles.filter((file) => !accountedFor.has(file))).toEqual([]);
    expect([...accountedFor].filter((file) => !sourceFiles.includes(file))).toEqual([]);
  });

  it("requires a useful reason for every exemption", () => {
    for (const reason of Object.values(UI_STATE_GALLERY_EXEMPTIONS)) {
      expect(reason.length).toBeGreaterThan(24);
    }
  });
});
