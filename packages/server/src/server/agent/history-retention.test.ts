import { describe, expect, it } from "vitest";
import { selectArchivedForDeletion } from "./history-retention.js";

const NOW = Date.parse("2026-07-25T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1_000;

function iso(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString();
}

describe("selectArchivedForDeletion", () => {
  it("selects nothing from an empty set", () => {
    expect(selectArchivedForDeletion({ records: [], olderThanDays: 0, now: NOW })).toEqual([]);
  });

  it("never selects a chat that is not archived, even with no age cutoff", () => {
    const ids = selectArchivedForDeletion({
      records: [
        { id: "active-undefined" },
        { id: "active-null", archivedAt: null },
        { id: "active-empty", archivedAt: "" },
        { id: "archived", archivedAt: iso(DAY) },
      ],
      olderThanDays: 0,
      now: NOW,
    });
    expect(ids).toEqual(["archived"]);
  });

  it("selects every archived chat when the cutoff is 0", () => {
    const ids = selectArchivedForDeletion({
      records: [
        { id: "old", archivedAt: iso(400 * DAY) },
        { id: "recent", archivedAt: iso(1_000) },
        { id: "active" },
      ],
      olderThanDays: 0,
      now: NOW,
    });
    expect(ids).toEqual(["old", "recent"]);
  });

  it("includes a chat archived exactly at the cutoff and excludes one a millisecond newer", () => {
    const ids = selectArchivedForDeletion({
      records: [
        { id: "exactly-7d", archivedAt: iso(7 * DAY) },
        { id: "just-inside-7d", archivedAt: iso(7 * DAY - 1) },
        { id: "just-past-7d", archivedAt: iso(7 * DAY + 1) },
      ],
      olderThanDays: 7,
      now: NOW,
    });
    // Oldest first: 7d+1ms, then exactly 7d. The 1ms-younger one is spared.
    expect(ids).toEqual(["just-past-7d", "exactly-7d"]);
  });

  it("skips an unparseable archivedAt when an age cutoff is set", () => {
    const ids = selectArchivedForDeletion({
      records: [
        { id: "garbage", archivedAt: "not-a-date" },
        { id: "old", archivedAt: iso(30 * DAY) },
      ],
      olderThanDays: 7,
      now: NOW,
    });
    expect(ids).toEqual(["old"]);
  });

  it("takes an unparseable archivedAt when the cutoff is 0, sorted last", () => {
    const ids = selectArchivedForDeletion({
      records: [
        { id: "garbage", archivedAt: "not-a-date" },
        { id: "old", archivedAt: iso(30 * DAY) },
        { id: "newer", archivedAt: iso(DAY) },
      ],
      olderThanDays: 0,
      now: NOW,
    });
    expect(ids).toEqual(["old", "newer", "garbage"]);
  });

  it("skips a future archivedAt under an age cutoff but takes it at 0", () => {
    const records = [{ id: "future", archivedAt: new Date(NOW + 5 * DAY).toISOString() }];
    expect(selectArchivedForDeletion({ records, olderThanDays: 1, now: NOW })).toEqual([]);
    expect(selectArchivedForDeletion({ records, olderThanDays: 0, now: NOW })).toEqual(["future"]);
  });

  it("returns ids oldest-first so a partial failure loses the least-wanted chats", () => {
    const ids = selectArchivedForDeletion({
      records: [
        { id: "middle", archivedAt: iso(10 * DAY) },
        { id: "newest", archivedAt: iso(2 * DAY) },
        { id: "oldest", archivedAt: iso(90 * DAY) },
      ],
      olderThanDays: 1,
      now: NOW,
    });
    expect(ids).toEqual(["oldest", "middle", "newest"]);
  });

  it("collapses duplicate ids so nothing is counted as two deletions", () => {
    const ids = selectArchivedForDeletion({
      records: [
        { id: "dup", archivedAt: iso(5 * DAY) },
        { id: "dup", archivedAt: iso(6 * DAY) },
      ],
      olderThanDays: 0,
      now: NOW,
    });
    expect(ids).toEqual(["dup"]);
  });

  it("ignores blank ids", () => {
    const ids = selectArchivedForDeletion({
      records: [
        { id: "  ", archivedAt: iso(DAY) },
        { id: "real", archivedAt: iso(DAY) },
      ],
      olderThanDays: 0,
      now: NOW,
    });
    expect(ids).toEqual(["real"]);
  });

  it("trims whitespace off selected ids", () => {
    const ids = selectArchivedForDeletion({
      records: [{ id: " padded ", archivedAt: iso(DAY) }],
      olderThanDays: 0,
      now: NOW,
    });
    expect(ids).toEqual(["padded"]);
  });

  it("coerces a nonsense cutoff to 0 rather than deleting on a NaN comparison", () => {
    const records = [{ id: "archived", archivedAt: iso(DAY) }, { id: "active" }];
    expect(selectArchivedForDeletion({ records, olderThanDays: Number.NaN, now: NOW })).toEqual([
      "archived",
    ]);
    expect(selectArchivedForDeletion({ records, olderThanDays: -5, now: NOW })).toEqual([
      "archived",
    ]);
  });

  it("floors a fractional cutoff instead of comparing against a fraction of a day", () => {
    const ids = selectArchivedForDeletion({
      records: [{ id: "seven-and-a-bit", archivedAt: iso(7 * DAY + 1) }],
      olderThanDays: 7.9,
      now: NOW,
    });
    expect(ids).toEqual(["seven-and-a-bit"]);
  });
});
