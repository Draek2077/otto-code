import { describe, expect, it, vi } from "vitest";
import { ManualCommitDraft, manualCommitMessage } from "./manual-commit";
describe("manual commits", () => {
  it("formats git-cz types without rewriting an authored conventional header", () => {
    expect(manualCommitMessage("fix", "  handle reconnect  ")).toBe("fix: handle reconnect");
    expect(manualCommitMessage("feat", "fix(api)!: preserve the header")).toBe(
      "fix(api)!: preserve the header",
    );
    expect(manualCommitMessage("none", "  verbatim subject  ")).toBe("verbatim subject");
  });
  it("submits only checked files, including both sides of a selected rename", async () => {
    const commit = vi.fn(async () => undefined);
    const draft = new ManualCommitDraft(commit);
    draft.setFiles([{ path: "keep.ts" }, { path: "new.ts", oldPath: "old.ts" }]);
    draft.toggle("keep.ts");
    draft.edit({ type: "refactor", message: "rename file" });
    await draft.submit();
    expect(commit.mock.calls[0]?.slice(0, 2)).toEqual([
      "refactor: rename file",
      ["new.ts", "old.ts"],
    ]);
    expect(draft.getSnapshot().message).toBe("");
  });
  it("does not submit an empty selection", async () => {
    const commit = vi.fn(async () => undefined),
      draft = new ManualCommitDraft(commit);
    draft.setFiles([{ path: "a.ts" }]);
    draft.edit({ message: "message" });
    draft.toggleAll();
    await draft.submit();
    expect(commit).not.toHaveBeenCalled();
    expect(draft.getSnapshot().message).toBe("message");
  });
  it("serializes clicks and preserves a newer message while a commit completes", async () => {
    let resolve!: () => void;
    const commit = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const draft = new ManualCommitDraft(commit);
    draft.setFiles([{ path: "a.ts" }]);
    draft.edit({ message: "first" });
    const running = draft.submit();
    await draft.submit();
    draft.edit({ message: "next" });
    resolve();
    await running;
    expect(commit).toHaveBeenCalledTimes(1);
    expect(draft.getSnapshot().message).toBe("next");
  });
  it("retains the draft, selection and console output on failure without retrying", async () => {
    const commit = vi.fn(
      async (_message: string, _paths: string[], output: (text: string) => void) => {
        output("pre-commit rejected the commit");
        throw new Error("Hook failed");
      },
    );
    const draft = new ManualCommitDraft(commit);
    draft.setFiles([{ path: "a.ts" }, { path: "b.ts" }]);
    draft.toggle("b.ts");
    draft.edit({ message: "keep this" });
    await draft.submit();
    expect(draft.getSnapshot()).toMatchObject({
      message: "keep this",
      pending: false,
      error: "Hook failed",
      output: "pre-commit rejected the commit",
    });
    expect(draft.selected("b.ts")).toBe(false);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
