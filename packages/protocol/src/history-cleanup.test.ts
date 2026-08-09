import { describe, expect, it } from "vitest";
import {
  HistoryAgentsClearArchivedRequestSchema,
  HistoryAgentsClearArchivedResponseSchema,
} from "./messages.js";

describe("provider-aware history cleanup protocol", () => {
  it("keeps the cleanup scope additive and defaults old requests safely", () => {
    const parsed = HistoryAgentsClearArchivedRequestSchema.parse({
      type: "history.agents.clear_archived.request",
      requestId: "r1",
    });
    expect(parsed.dryRun).toBe(true);
    expect(parsed.cleanupScope).toBeUndefined();
  });

  it("accepts per-item provider outcomes and separate byte totals", () => {
    const parsed = HistoryAgentsClearArchivedResponseSchema.parse({
      type: "history.agents.clear_archived.response",
      payload: {
        matched: 1,
        deleted: 0,
        failed: 1,
        agentIds: [],
        dryRun: false,
        error: null,
        requestId: "r1",
        ottoBytes: 100,
        providerBytes: 0,
        reclaimedBytes: 0,
        unsupported: 1,
        stale: 0,
        outcomes: [{ agentId: "a1", outcome: "unsupported" }],
      },
    });
    expect(parsed.payload.outcomes?.[0]?.outcome).toBe("unsupported");
  });
});
