import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

import { withTemporaryOttoHome } from "../../../test-utils/temp-otto-home.js";
import {
  clearMaterializedProviderImages,
  isProviderImageMarkdown,
  materializeProviderImage,
  readMaterializedImageStats,
  reclaimLegacyProviderImageDirs,
  renderProviderImageOutputAsAssistantMarkdown,
  sweepMaterializedProviderImages,
} from "./provider-image-output.js";

const HASH = "a".repeat(64);
const DAY_MS = 24 * 60 * 60 * 1_000;

const getOttoHome = withTemporaryOttoHome("otto-home-image-test");

function attachmentsDir(): string {
  return path.join(getOttoHome(), "attachments");
}

function writeStoredImage(name: string, sizeBytes: number, ageMs: number): void {
  mkdirSync(attachmentsDir(), { recursive: true });
  const filePath = path.join(attachmentsDir(), name);
  writeFileSync(filePath, Buffer.alloc(sizeBytes, 1));
  const when = new Date(Date.now() - ageMs);
  utimesSync(filePath, when, when);
}

function renderImageMarkdown(imagePath: string): string {
  const item = renderProviderImageOutputAsAssistantMarkdown({ path: imagePath });
  if (!item || item.type !== "assistant_message") {
    throw new Error("Expected provider image output to render as assistant markdown.");
  }
  return item.text;
}

describe("isProviderImageMarkdown", () => {
  test("matches the markdown emitted for a materialized attachment", () => {
    expect(isProviderImageMarkdown(`![Image](/home/me/.otto/attachments/${HASH}.png)`)).toBe(true);
    // The retired temp-dir layout, which older transcripts still name.
    expect(isProviderImageMarkdown(`![Image](/tmp/otto-attachments/${HASH}.png)`)).toBe(true);
    expect(isProviderImageMarkdown(`![Image](/tmp/otto-attachments-a1B2c3/${HASH}.png)`)).toBe(
      true,
    );
    expect(isProviderImageMarkdown(`![Image](/tmp/otto-attachments/user-1000/${HASH}.png)`)).toBe(
      true,
    );
    expect(isProviderImageMarkdown(`![shot](/var/folders/x/otto-attachments/${HASH}.webp)`)).toBe(
      true,
    );
    // Windows: backslash path separators are doubled by escapeMarkdownImageSource.
    expect(
      isProviderImageMarkdown(
        `![Image](C:\\\\Users\\\\me\\\\AppData\\\\Local\\\\Temp\\\\otto-attachments\\\\${HASH}.png)`,
      ),
    ).toBe(true);
    expect(
      isProviderImageMarkdown(`![Image](file:///C:/Users/me/.otto/attachments/${HASH}.png)`),
    ).toBe(true);
  });

  test("emits Windows file paths as file URIs", () => {
    const markdown = renderImageMarkdown(`C:\\Users\\me\\.otto\\attachments\\${HASH}.png`);

    expect(markdown).toBe(`![Image](file:///C:/Users/me/.otto/attachments/${HASH}.png)`);
    expect(isProviderImageMarkdown(markdown)).toBe(true);
  });

  test("emits POSIX file paths with spaces as valid file URI markdown", () => {
    const markdown = renderImageMarkdown("/home/user/Projects/Project With Spaces/screenshot.png");

    expect(markdown).toBe(
      "![Image](file:///home/user/Projects/Project%20With%20Spaces/screenshot.png)",
    );
  });

  test("encodes URI-significant characters in POSIX file paths", () => {
    const markdown = renderImageMarkdown("/tmp/screenshot#1?draft.png");

    expect(markdown).toBe("![Image](file:///tmp/screenshot%231%3Fdraft.png)");
  });

  test("preserves double-leading slashes in POSIX file paths", () => {
    const markdown = renderImageMarkdown("//tmp/screenshot#1.png");

    expect(markdown).toBe("![Image](file:////tmp/screenshot%231.png)");
  });

  test.each([
    ["UNC", "\\\\server\\share\\shot#1.png", "file://server/share/shot%231.png"],
    [
      "extended UNC",
      "\\\\?\\UNC\\server\\share\\shot?draft.png",
      "file://server/share/shot%3Fdraft.png",
    ],
  ])("encodes %s image paths as file URIs", (_label, imagePath, expectedSource) => {
    expect(renderImageMarkdown(imagePath)).toBe(`![Image](${expectedSource})`);
  });

  test("rejects user-authored markdown that is not a materialized attachment", () => {
    // No content hash - a hand-written path, not something the writer produced.
    expect(isProviderImageMarkdown("![diagram](./otto-attachments/notes.png)")).toBe(false);
    expect(isProviderImageMarkdown("![diagram](./attachments/notes.png)")).toBe(false);
    expect(isProviderImageMarkdown("![logo](https://example.com/logo.png)")).toBe(false);
    // Image markdown that does not start the text.
    expect(isProviderImageMarkdown("see the chart: ![chart](x.png)")).toBe(false);
  });
});

describe("materializeProviderImage", () => {
  afterEach(() => {
    rmSync(attachmentsDir(), { recursive: true, force: true });
  });

  test("writes into the OTTO_HOME attachment store", () => {
    const materialized = materializeProviderImage({ data: "YWJjMTIz", mimeType: "image/png" });

    expect(path.dirname(materialized.path)).toBe(attachmentsDir());
    expect(existsSync(materialized.path)).toBe(true);
  });

  test("recreates the store if the directory is removed under it", () => {
    const first = materializeProviderImage({ data: "YWJjMTIz", mimeType: "image/png" });
    expect(existsSync(first.path)).toBe(true);

    rmSync(attachmentsDir(), { recursive: true, force: true });

    const second = materializeProviderImage({ data: "ZGVmNDU2", mimeType: "image/png" });
    expect(existsSync(second.path)).toBe(true);
  });

  test("reuses one file for identical bytes", () => {
    const first = materializeProviderImage({ data: "YWJjMTIz", mimeType: "image/png" });
    const second = materializeProviderImage({ data: "YWJjMTIz", mimeType: "image/png" });

    expect(second.path).toBe(first.path);
    expect(readdirSync(attachmentsDir())).toHaveLength(1);
  });
});

describe("sweepMaterializedProviderImages", () => {
  afterEach(() => {
    rmSync(attachmentsDir(), { recursive: true, force: true });
  });

  test("deletes cold images and leaves live ones alone", () => {
    writeStoredImage(`${"b".repeat(64)}.png`, 128, 40 * DAY_MS);
    writeStoredImage(`${"c".repeat(64)}.png`, 128, 2 * DAY_MS);

    const result = sweepMaterializedProviderImages({ ottoHome: getOttoHome() });

    expect(result.deleted).toBe(1);
    expect(result.freedBytes).toBe(128);
    expect(readdirSync(attachmentsDir())).toEqual([`${"c".repeat(64)}.png`]);
  });

  test("never touches a file that is not a content-hashed image", () => {
    mkdirSync(attachmentsDir(), { recursive: true });
    const stray = path.join(attachmentsDir(), "notes.txt");
    writeFileSync(stray, "keep me");
    const when = new Date(Date.now() - 400 * DAY_MS);
    utimesSync(stray, when, when);

    const result = sweepMaterializedProviderImages({ ottoHome: getOttoHome() });

    expect(result.deleted).toBe(0);
    expect(existsSync(stray)).toBe(true);
  });

  test("reports nothing when the store does not exist yet", () => {
    expect(sweepMaterializedProviderImages({ ottoHome: getOttoHome() })).toEqual({
      deleted: 0,
      freedBytes: 0,
    });
  });
});

describe("readMaterializedImageStats", () => {
  afterEach(() => {
    rmSync(attachmentsDir(), { recursive: true, force: true });
  });

  test("totals the store and reports the oldest image", () => {
    writeStoredImage(`${"b".repeat(64)}.png`, 300, 10 * DAY_MS);
    writeStoredImage(`${"c".repeat(64)}.png`, 700, 1 * DAY_MS);

    const stats = readMaterializedImageStats(getOttoHome());

    expect(stats.fileCount).toBe(2);
    expect(stats.totalBytes).toBe(1000);
    expect(stats.oldestAtMs).toBeLessThan(Date.now() - 9 * DAY_MS);
  });

  test("reads an absent store as empty rather than failing", () => {
    expect(readMaterializedImageStats(getOttoHome())).toEqual({
      fileCount: 0,
      totalBytes: 0,
      oldestAtMs: null,
    });
  });
});

describe("clearMaterializedProviderImages", () => {
  afterEach(() => {
    rmSync(attachmentsDir(), { recursive: true, force: true });
  });

  test("a dry run reports what would go and deletes nothing", () => {
    writeStoredImage(`${"b".repeat(64)}.png`, 300, 40 * DAY_MS);
    writeStoredImage(`${"c".repeat(64)}.png`, 700, 1 * DAY_MS);

    const result = clearMaterializedProviderImages({ ottoHome: getOttoHome(), dryRun: true });

    expect(result).toEqual({ matched: 2, deleted: 0, freedBytes: 1000 });
    expect(readdirSync(attachmentsDir())).toHaveLength(2);
  });

  test("defaults to a dry run when the flag is omitted", () => {
    writeStoredImage(`${"b".repeat(64)}.png`, 300, 1 * DAY_MS);

    const result = clearMaterializedProviderImages({ ottoHome: getOttoHome() });

    expect(result.deleted).toBe(0);
    expect(readdirSync(attachmentsDir())).toHaveLength(1);
  });

  test("clears the whole store when committed with no age limit", () => {
    writeStoredImage(`${"b".repeat(64)}.png`, 300, 40 * DAY_MS);
    writeStoredImage(`${"c".repeat(64)}.png`, 700, 0);

    const result = clearMaterializedProviderImages({ ottoHome: getOttoHome(), dryRun: false });

    expect(result).toEqual({ matched: 2, deleted: 2, freedBytes: 1000 });
    expect(readdirSync(attachmentsDir())).toEqual([]);
  });

  test("an age limit spares what is younger than the cutoff", () => {
    writeStoredImage(`${"b".repeat(64)}.png`, 300, 40 * DAY_MS);
    const kept = `${"c".repeat(64)}.png`;
    writeStoredImage(kept, 700, 1 * DAY_MS);

    const result = clearMaterializedProviderImages({
      ottoHome: getOttoHome(),
      olderThanDays: 7,
      dryRun: false,
    });

    expect(result).toEqual({ matched: 1, deleted: 1, freedBytes: 300 });
    expect(readdirSync(attachmentsDir())).toEqual([kept]);
  });
});

describe("reclaimLegacyProviderImageDirs", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "otto-legacy-scan-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    for (const entry of readdirSync(tmpDir)) {
      rmSync(path.join(tmpDir, entry), { recursive: true, force: true });
    }
  });

  function legacyDir(name: string, fileAgeMs?: number): string {
    const dir = path.join(tmpDir, name);
    mkdirSync(dir, { recursive: true });
    if (fileAgeMs !== undefined) {
      const filePath = path.join(dir, `${HASH}.png`);
      writeFileSync(filePath, Buffer.alloc(16, 1));
      const when = new Date(Date.now() - fileAgeMs);
      utimesSync(filePath, when, when);
    }
    return dir;
  }

  test("removes the empty directories the retired layout left behind", () => {
    const empty = legacyDir("otto-attachments-aaaaaa");

    const result = reclaimLegacyProviderImageDirs({ tmpDir });

    expect(result.removed).toBe(1);
    expect(existsSync(empty)).toBe(false);
  });

  test("leaves a directory a live daemon may still be writing to", () => {
    const active = legacyDir("otto-attachments-bbbbbb", 60 * 60 * 1_000);

    const result = reclaimLegacyProviderImageDirs({ tmpDir });

    expect(result.removed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(existsSync(active)).toBe(true);
  });

  test("removes a stale directory along with its images", () => {
    const stale = legacyDir("otto-attachments-cccccc", 30 * DAY_MS);

    const result = reclaimLegacyProviderImageDirs({ tmpDir });

    expect(result.removed).toBe(1);
    expect(existsSync(stale)).toBe(false);
  });

  test("ignores directories that are not part of the retired layout", () => {
    const unrelated = legacyDir("some-other-tool-cache");

    const result = reclaimLegacyProviderImageDirs({ tmpDir });

    expect(result).toEqual({ removed: 0, skipped: 0 });
    expect(existsSync(unrelated)).toBe(true);
  });
});
