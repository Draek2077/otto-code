import { describe, expect, it } from "vitest";
import { requestHost } from "./host.js";
import { MemoryTuiHost } from "../../test-tui.js";

describe("typed terminal host results", () => {
  it("preserves the host's safe unsupported/conflict/failed messages", async () => {
    const host = new MemoryTuiHost();
    for (const status of ["unsupported", "conflict", "failed"] as const) {
      host.failure = { status, message: "Safe user message" };
      await expect(
        requestHost(host, { type: "refresh" }, new AbortController().signal),
      ).rejects.toMatchObject({ status, message: "Safe user message" });
    }
  });
  it("returns typed job admissions and never infers completion", async () => {
    const host = new MemoryTuiHost();
    const result = await requestHost(
      host,
      { type: "job.start", modelId: "model", operation: "calibrate" },
      new AbortController().signal,
    );
    expect(result).toEqual({ jobId: "operation-1" });
    expect(host.current.jobs).toEqual([]);
  });
});
