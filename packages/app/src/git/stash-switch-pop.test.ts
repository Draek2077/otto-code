import { describe, expect, it } from "vitest";
import { stashSwitchAndPop } from "./stash-switch-pop";

describe("stashSwitchAndPop", () => {
  it("stashes, switches, and restores the same stash in order", async () => {
    const calls: string[] = [];

    const result = await stashSwitchAndPop({
      saveStash: async () => {
        calls.push("stash");
        return { error: null };
      },
      switchBranch: async () => {
        calls.push("switch");
        return { ok: true };
      },
      popStash: async () => {
        calls.push("pop");
        return { error: null };
      },
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(["stash", "switch", "pop"]);
  });

  it("does not switch when creating the stash fails", async () => {
    const calls: string[] = [];

    const result = await stashSwitchAndPop({
      saveStash: async () => {
        calls.push("stash");
        return { error: { message: "stash failed" } };
      },
      switchBranch: async () => {
        calls.push("switch");
        return { ok: true };
      },
      popStash: async () => {
        calls.push("pop");
        return { error: null };
      },
    });

    expect(result).toEqual({ ok: false, stage: "stash", message: "stash failed" });
    expect(calls).toEqual(["stash"]);
  });

  it("keeps the stash when switching or restoring it fails", async () => {
    const switchFailure = await stashSwitchAndPop({
      saveStash: async () => ({ error: null }),
      switchBranch: async () => ({ ok: false, message: "checkout failed" }),
      popStash: async () => {
        throw new Error("must not pop after a failed checkout");
      },
    });
    const popFailure = await stashSwitchAndPop({
      saveStash: async () => ({ error: null }),
      switchBranch: async () => ({ ok: true }),
      popStash: async () => ({ error: { message: "conflict" } }),
    });

    expect(switchFailure).toEqual({ ok: false, stage: "switch", message: "checkout failed" });
    expect(popFailure).toEqual({ ok: false, stage: "pop", message: "conflict" });
  });
});
