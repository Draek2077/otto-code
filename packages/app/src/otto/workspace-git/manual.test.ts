import { expect, test, vi } from "vitest";
import { ManualGitFetch } from "./manual";
import { createGitFetchPort, GitFetchError } from "./port";

test("only an explicit action fetches; duplicates join the pending action and failure remains recoverable", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetch = vi.fn(() => pending);
  const model = new ManualGitFetch({ fetch, read: vi.fn(), save: vi.fn() }, "workspace");
  expect(fetch).not.toHaveBeenCalled();
  const first = model.run();
  await model.run();
  expect(model.getSnapshot()).toEqual({ status: "pending", error: null });
  expect(fetch).toHaveBeenCalledExactlyOnceWith("workspace");
  release();
  await first;
  expect(model.getSnapshot()).toEqual({ status: "success", error: null });
  fetch.mockRejectedValueOnce(new GitFetchError("Check origin access."));
  await model.run();
  expect(model.getSnapshot()).toEqual({ status: "idle", error: "Check origin access." });
  await model.run();
  expect(model.getSnapshot()).toEqual({ status: "success", error: null });
});
test("the real RPC adapter binds the host/workspace and extends only the explicit fetch deadline", async () => {
  const invoke = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    ok: true,
    value: { remote: "origin" },
  }));
  const port = createGitFetchPort("host", invoke);
  await port.fetch("workspace");
  expect(invoke).toHaveBeenCalledExactlyOnceWith(
    "workspace.git.fetch.request",
    { hostId: "host", workspaceId: "workspace" },
    130_000,
  );
  invoke.mockResolvedValueOnce({
    ok: false,
    error: { kind: "failed", message: "Host Git access failed." },
  });
  await expect(port.fetch("workspace")).rejects.toThrow("Host Git access failed.");
});
