import { describe, expect, it, vi } from "vitest";
import { performTuiAction } from "./actions.js";
describe("terminal operation dispatch", () => {
  it("previews a fit against its originating profile revision without writing", async () => {
    const request = vi.fn().mockResolvedValue({ revision: "origin", maxContextThatFits: 16384 });
    expect(
      await performTuiAction(
        {
          type: "profile.fit",
          modelId: "opaque/model",
          expectedRevision: "origin",
          patch: { cacheTypeK: "q4_0" },
        },
        request,
      ),
    ).toEqual({ kind: "value", value: { contextSize: 16384 } });
    expect(request).toHaveBeenCalledExactlyOnceWith("/__host/model/budget?id=opaque%2Fmodel", {
      patch: { cacheTypeK: "q4_0" },
    });
  });
  it("rejects a peer-changed fit instead of adopting its revision or applying a stale preview", async () => {
    const request = vi.fn().mockResolvedValue({ revision: "peer", maxContextThatFits: 16384 });
    await expect(
      performTuiAction(
        { type: "profile.fit", modelId: "model", expectedRevision: "origin", patch: {} },
        request,
      ),
    ).rejects.toMatchObject({ status: "conflict" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each(["install", "remove"] as const)(
    "submits runtime %s by opaque identity and returns an actual admitted job",
    async (operation) => {
      const request = vi.fn().mockResolvedValue({
        job: {
          id: "actual-job",
          operation: `runtime-${operation}`,
          subject: { modelId: null },
          state: "queued",
          progress: null,
          error: null,
          result: { private: "not-for-ui" },
        },
      });
      const result = await performTuiAction(
        { type: `runtime.${operation}`, runtimeId: "opaque-runtime-id" },
        request,
      );
      expect(result).toMatchObject({
        kind: "job",
        job: { id: "actual-job", operation: "runtime", state: "queued", cancelable: true },
      });
      expect(request.mock.calls[0][1]).toEqual({ runtimeId: "opaque-runtime-id" });
      expect(JSON.stringify(result)).not.toContain("not-for-ui");
    },
  );
  it("does not dispatch caller-supplied paths or an unknown operation", async () => {
    const request = vi.fn();
    await expect(
      performTuiAction({ type: "arbitrary", route: "file:///private" }, request),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
