import { describe, expect, test } from "vitest";

import {
  selectMaterializedImagesToClear,
  selectStaleMaterializedImages,
} from "./provider-image-retention.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = 1_800_000_000_000;

function file(name: string, ageDays: number, sizeBytes = 100_000) {
  return { name, sizeBytes, modifiedAtMs: NOW - ageDays * DAY_MS };
}

describe("selectStaleMaterializedImages", () => {
  test("deletes what nobody has re-materialized past the age cutoff", () => {
    const doomed = selectStaleMaterializedImages({
      files: [file("cold.png", 40), file("warm.png", 3)],
      now: NOW,
      maxAgeMs: 30 * DAY_MS,
      maxTotalBytes: 0,
    });

    expect(doomed).toEqual(["cold.png"]);
  });

  test("keeps an image sitting exactly on the cutoff", () => {
    const doomed = selectStaleMaterializedImages({
      files: [file("edge.png", 30)],
      now: NOW,
      maxAgeMs: 30 * DAY_MS,
      maxTotalBytes: 0,
    });

    expect(doomed).toEqual([]);
  });

  test("falls back to oldest-first once the survivors still exceed the cap", () => {
    const doomed = selectStaleMaterializedImages({
      files: [file("a.png", 3, 400), file("b.png", 2, 400), file("c.png", 1, 400)],
      now: NOW,
      maxAgeMs: 30 * DAY_MS,
      maxTotalBytes: 900,
    });

    // 1200 bytes against a 900 cap: the oldest goes, and 800 fits.
    expect(doomed).toEqual(["a.png"]);
  });

  test("never ages out a file stamped in the future, but still counts it against the cap", () => {
    const byAge = selectStaleMaterializedImages({
      files: [file("skewed.png", -5)],
      now: NOW,
      maxAgeMs: 30 * DAY_MS,
      maxTotalBytes: 0,
    });
    expect(byAge).toEqual([]);

    const byCap = selectStaleMaterializedImages({
      files: [file("skewed.png", -5, 400), file("old.png", 1, 400)],
      now: NOW,
      maxAgeMs: 30 * DAY_MS,
      maxTotalBytes: 300,
    });
    // Oldest first: the real timestamp goes before the unprovable one.
    expect(byCap).toEqual(["old.png", "skewed.png"]);
  });

  test("does nothing when both levers are disabled", () => {
    const doomed = selectStaleMaterializedImages({
      files: [file("ancient.png", 900, 10_000_000)],
      now: NOW,
      maxAgeMs: 0,
      maxTotalBytes: 0,
    });

    expect(doomed).toEqual([]);
  });
});

describe("selectMaterializedImagesToClear", () => {
  test("takes everything at olderThanDays 0 — the opposite of the sweep's reading", () => {
    const files = [file("a.png", 40), file("b.png", 0)];

    expect(selectMaterializedImagesToClear({ files, now: NOW, olderThanDays: 0 })).toEqual([
      "a.png",
      "b.png",
    ]);
    // The background sweep reads a zero age as "age rule off" and takes nothing.
    expect(
      selectStaleMaterializedImages({ files, now: NOW, maxAgeMs: 0, maxTotalBytes: 0 }),
    ).toEqual([]);
  });

  test("limits to images untouched for at least the cutoff, oldest first", () => {
    const doomed = selectMaterializedImagesToClear({
      files: [file("recent.png", 2), file("old.png", 20), file("older.png", 60)],
      now: NOW,
      olderThanDays: 7,
    });

    expect(doomed).toEqual(["older.png", "old.png"]);
  });

  test("includes an image sitting exactly on the cutoff", () => {
    const doomed = selectMaterializedImagesToClear({
      files: [file("edge.png", 7)],
      now: NOW,
      olderThanDays: 7,
    });

    expect(doomed).toEqual(["edge.png"]);
  });

  test("skips a future-stamped image under an age limit but takes it in a full clear", () => {
    const files = [file("skewed.png", -5)];

    expect(selectMaterializedImagesToClear({ files, now: NOW, olderThanDays: 7 })).toEqual([]);
    expect(selectMaterializedImagesToClear({ files, now: NOW, olderThanDays: 0 })).toEqual([
      "skewed.png",
    ]);
  });
});
