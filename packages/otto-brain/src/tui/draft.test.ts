import { describe, expect, it } from "vitest";
import { ProfileDraft } from "./draft.js";
import { MemoryTuiHost } from "../../test-tui.js";

describe("revisioned terminal profile drafts", () => {
  it("sends only edited fields with the opaque host revision", async () => {
    const host = new MemoryTuiHost();
    const draft = new ProfileDraft(host.current.models[0]);
    draft.write("contextSize", 16384);
    await draft.save(host, host.current.models[0].model.id, new AbortController().signal);
    expect(host.actions).toEqual([
      {
        type: "profile.save",
        modelId: host.current.models[0].model.id,
        patch: { contextSize: 16384 },
        expectedRevision: "revision-1",
      },
    ]);
    expect(draft.dirty).toBe(false);
    expect(draft.revision).toBe("revision-1+");
  });

  it("serializes edits made during a save and adopts the returned revision", async () => {
    const host = new MemoryTuiHost();
    let release = (): void => {};
    host.wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const draft = new ProfileDraft(host.current.models[0]);
    draft.write("contextSize", 16384);
    const saving = draft.save(host, host.current.models[0].model.id, new AbortController().signal);
    draft.write("temperature", 0.85);
    expect(draft.save(host, host.current.models[0].model.id, new AbortController().signal)).toBe(
      saving,
    );
    release();
    await saving;
    expect(host.actions).toHaveLength(2);
    expect(host.actions[1]).toMatchObject({
      patch: { temperature: 0.85 },
      expectedRevision: "revision-1+",
    });
    expect(draft.profile.contextSize).toBe(16384);
    expect(draft.profile.temperature).toBe(0.85);
  });

  it("preserves dirty values on a conflict and prevents automatic retries", async () => {
    const host = new MemoryTuiHost();
    host.failure = { status: "conflict", message: "This profile changed in another client." };
    const row = host.current.models[0];
    const draft = new ProfileDraft(row);
    draft.write("contextSize", 24576);
    await expect(draft.save(host, row.model.id, new AbortController().signal)).rejects.toThrow(
      "another client",
    );
    row.profile.contextSize = 4096;
    row.revision = "peer-revision";
    draft.receive(row);
    expect(draft.profile.contextSize).toBe(24576);
    expect(draft.dirty).toBe(true);
    await expect(draft.save(host, row.model.id, new AbortController().signal)).rejects.toThrow(
      "another client",
    );
    expect(host.actions).toHaveLength(1);
    draft.discard(row);
    expect(draft.profile.contextSize).toBe(4096);
    expect(draft.revision).toBe("peer-revision");
  });

  it("keeps drafts independent of snapshot objects and hides raw transport errors", async () => {
    const host = new MemoryTuiHost();
    const row = host.current.models[0];
    const draft = new ProfileDraft(row);
    draft.write("contextSize", 1024);
    expect(row.profile.contextSize).toBe(8192);
    host.transportError = new Error("credential=secret at private/path");
    await expect(draft.save(host, row.model.id, new AbortController().signal)).rejects.toThrow(
      "could not complete",
    );
    expect(draft.error).not.toContain("secret");
    expect(draft.dirty).toBe(true);
  });
});
