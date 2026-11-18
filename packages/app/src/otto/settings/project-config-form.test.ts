import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectConfigSettingsForm } from "./project-config-form";

const revision = { mtimeMs: 1, size: 10 };
const config = { worktree: { setup: "initial" }, future: { retained: true } };
const read = async () => ({
  ok: true as const,
  config,
  revision,
  requestId: "read",
  repoRoot: "fixture",
});
afterEach(() => vi.useRealTimers());

describe("project preference autosave", () => {
  it("suspends editing during an explicit saved-state reload", async () => {
    let finish: (value: Awaited<ReturnType<typeof read>>) => void = () => {
      throw new Error("not started");
    };
    const write = vi.fn();
    const model = new ProjectConfigSettingsForm(config, revision, {
      read: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      write,
      valid: () => true,
      accepted: () => {},
    });
    const close = model.activate();
    const reading = model.reload();
    expect(model.getSnapshot().reading).toBe(true);
    model.edit((draft) => ({ ...draft, setupText: "late input" }));
    finish(await read());
    await reading;
    expect(model.getSnapshot()).toMatchObject({
      reading: false,
      dirty: false,
      draft: { setupText: "initial" },
    });
    expect(write).not.toHaveBeenCalled();
    close();
  });
  it("debounces text, serializes edits and advances only its acknowledged revision", async () => {
    vi.useFakeTimers();
    const nextRevision = { mtimeMs: 2, size: 20 };
    const write = vi
      .fn<ConstructorParameters<typeof ProjectConfigSettingsForm>[2]["write"]>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockImplementation(async (value) => ({
        ok: true,
        config: value,
        revision: { mtimeMs: 3, size: 30 },
        requestId: "write",
        repoRoot: "fixture",
      }));
    let finish: (value: Awaited<ReturnType<typeof write>>) => void = () => {
      throw new Error("not started");
    };
    const model = new ProjectConfigSettingsForm(config, revision, {
      read,
      write,
      valid: () => true,
      accepted: () => {},
    });
    const close = model.activate();
    model.edit((draft) => ({ ...draft, setupText: "first" }));
    model.edit((draft) => ({ ...draft, setupText: "second" }));
    await vi.advanceTimersByTimeAsync(300);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      worktree: { setup: "second" },
      future: { retained: true },
    });
    model.edit((draft) => ({ ...draft, teardownText: "newer" }));
    finish({
      ok: true,
      config: write.mock.calls[0]![0],
      revision: nextRevision,
      requestId: "write",
      repoRoot: "fixture",
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]?.[1]).toEqual(nextRevision);
    expect(write.mock.calls[1]?.[0].worktree?.teardown).toBe("newer");
    expect(model.getSnapshot().dirty).toBe(false);
    close();
  });
  it("keeps a conflicted draft and never retries or rebases after another edit", async () => {
    vi.useFakeTimers();
    const write = vi.fn<ConstructorParameters<typeof ProjectConfigSettingsForm>[2]["write"]>(
      async () => ({
        ok: false,
        error: { code: "stale_project_config", currentRevision: revision },
        requestId: "write",
        repoRoot: "fixture",
      }),
    );
    const model = new ProjectConfigSettingsForm(config, revision, {
      read,
      write,
      valid: () => true,
      accepted: () => {},
    });
    const close = model.activate();
    model.edit((draft) => ({ ...draft, setupText: "mine" }));
    await vi.advanceTimersByTimeAsync(300);
    model.edit((draft) => ({ ...draft, setupText: "still mine" }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(model.getSnapshot()).toMatchObject({
      dirty: true,
      error: { code: "stale_project_config" },
      draft: { setupText: "still mine" },
    });
    await model.reload();
    expect(model.getSnapshot()).toMatchObject({
      dirty: false,
      error: null,
      draft: { setupText: "initial" },
    });
    close();
  });
  it("does not save incomplete scripts or adopt a late hidden write", async () => {
    vi.useFakeTimers();
    const write = vi.fn<ConstructorParameters<typeof ProjectConfigSettingsForm>[2]["write"]>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let finish: (value: Awaited<ReturnType<typeof write>>) => void = () => {
      throw new Error("not started");
    };
    const accepted = vi.fn();
    const model = new ProjectConfigSettingsForm(config, revision, {
      read,
      write,
      valid: (draft) => draft.setupText !== "invalid",
      accepted,
    });
    const close = model.activate();
    model.edit((draft) => ({ ...draft, setupText: "invalid" }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).not.toHaveBeenCalled();
    model.edit((draft) => ({ ...draft, setupText: "valid" }));
    await vi.advanceTimersByTimeAsync(300);
    close();
    const closeAgain = model.activate();
    finish(await read());
    await vi.advanceTimersByTimeAsync(1000);
    expect(accepted).not.toHaveBeenCalled();
    expect(model.getSnapshot()).toMatchObject({
      dirty: true,
      error: { code: "write_failed" },
      draft: { setupText: "valid" },
    });
    expect(write).toHaveBeenCalledTimes(1);
    closeAgain();
  });
});
