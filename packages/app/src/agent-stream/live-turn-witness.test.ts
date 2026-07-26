import { beforeEach, describe, expect, it } from "vitest";

import {
  clearLiveTurnWitnesses,
  markLiveTurnSegmentWitnessed,
  wasLiveTurnSegmentWitnessed,
} from "./live-turn-witness";

describe("live turn witness", () => {
  beforeEach(() => {
    clearLiveTurnWitnesses();
  });

  it("remembers a segment it saw live and knows nothing of one it did not", () => {
    markLiveTurnSegmentWitnessed({ groupId: "group-a", blockIndex: 1 });

    expect(wasLiveTurnSegmentWitnessed({ groupId: "group-a", blockIndex: 1 })).toBe(true);
    // A history row: never rendered live, so never spoken.
    expect(wasLiveTurnSegmentWitnessed({ groupId: "group-b", blockIndex: 0 })).toBe(false);
  });

  it("witnesses each block of a group separately", () => {
    markLiveTurnSegmentWitnessed({ groupId: "group-a", blockIndex: 0 });

    expect(wasLiveTurnSegmentWitnessed({ groupId: "group-a", blockIndex: 0 })).toBe(true);
    expect(wasLiveTurnSegmentWitnessed({ groupId: "group-a", blockIndex: 1 })).toBe(false);
  });

  it("evicts oldest-first past the cap instead of growing forever", () => {
    for (let index = 0; index < 600; index += 1) {
      markLiveTurnSegmentWitnessed({ groupId: "group", blockIndex: index });
    }

    expect(wasLiveTurnSegmentWitnessed({ groupId: "group", blockIndex: 0 })).toBe(false);
    expect(wasLiveTurnSegmentWitnessed({ groupId: "group", blockIndex: 599 })).toBe(true);
  });
});
