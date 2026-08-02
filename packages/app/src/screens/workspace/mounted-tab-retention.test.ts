import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { MAX_MOUNTED_TAB_LIMIT, MIN_MOUNTED_TAB_LIMIT } from "@/hooks/use-settings/storage";
import {
  AUTO_MOUNTED_TAB_LIMIT_COMPACT,
  AUTO_MOUNTED_TAB_LIMIT_DESKTOP,
  resolveMountedTabLimit,
} from "./mounted-tab-retention";

describe("resolveMountedTabLimit", () => {
  it("picks the per-device default when the user has not chosen", () => {
    assert.equal(
      resolveMountedTabLimit({ setting: null, isCompact: false }),
      AUTO_MOUNTED_TAB_LIMIT_DESKTOP,
    );
    assert.equal(
      resolveMountedTabLimit({ setting: null, isCompact: true }),
      AUTO_MOUNTED_TAB_LIMIT_COMPACT,
    );
  });

  it("treats an explicit choice as absolute, including on a compact device", () => {
    // The device sizes the DEFAULT. Narrowing a deliberate choice would make the
    // setting a suggestion, and the user is the one who knows their machine.
    assert.equal(resolveMountedTabLimit({ setting: 10, isCompact: true }), 10);
    assert.equal(resolveMountedTabLimit({ setting: 2, isCompact: false }), 2);
  });

  it("clamps to the correctness bounds", () => {
    assert.equal(resolveMountedTabLimit({ setting: 99, isCompact: false }), MAX_MOUNTED_TAB_LIMIT);
    // At 1 every switch is a cold mount and retention is unreachable.
    assert.equal(resolveMountedTabLimit({ setting: 1, isCompact: false }), MIN_MOUNTED_TAB_LIMIT);
    assert.equal(resolveMountedTabLimit({ setting: 0, isCompact: false }), MIN_MOUNTED_TAB_LIMIT);
  });

  it("floors a fractional stored value rather than passing it to the LRU", () => {
    assert.equal(resolveMountedTabLimit({ setting: 6.9, isCompact: false }), 6);
  });
});
