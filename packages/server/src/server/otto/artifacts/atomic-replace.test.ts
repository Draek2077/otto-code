import { expect, it, vi } from "vitest";
import { replaceStagedArtifact } from "./atomic-replace.js";

function fixture() {
  const files = new Map<string, string>([
    ["stage", "new"],
    ["target", "old"],
  ]);
  const denied = Object.assign(new Error("native denial"), { code: "EPERM" });
  const rename = vi.fn(async (): Promise<void> => {
    throw denied;
  });
  const wait = vi.fn(async (_ms: number) => undefined);
  const read = vi.fn(async (file: string) => files.get(file) ?? null);
  const ports = { windows: true, rename, wait, read };
  return {
    files,
    denied,
    rename,
    wait,
    read,
    ports,
    run: () => replaceStagedArtifact("stage", "target", "new", ports),
  };
}
it("recovers one Windows sharing denial only after both captured files are revalidated", async () => {
  const f = fixture();
  f.rename.mockImplementationOnce(async () => {
    throw f.denied;
  });
  f.rename.mockImplementationOnce(async () => {
    f.files.set("target", "new");
    f.files.delete("stage");
  });
  await f.run();
  expect(f.rename).toHaveBeenCalledTimes(2);
  expect(f.read.mock.calls).toEqual([["target"], ["stage"], ["target"]]);
  expect(f.wait).toHaveBeenCalledExactlyOnceWith(10);
  expect(f.files.get("target")).toBe("new");
});
it("bounds a permanent denial without modifying either file or hiding its original error", async () => {
  const f = fixture();
  await expect(f.run()).rejects.toBe(f.denied);
  expect(f.rename).toHaveBeenCalledTimes(4);
  expect(f.wait.mock.calls).toEqual([[10], [25], [50]]);
  expect([...f.files]).toEqual([
    ["stage", "new"],
    ["target", "old"],
  ]);
});
it.each(["changed-target", "changed-stage", "missing-stage", "unreadable"])(
  "does not retry an uncertain replacement (%s)",
  async (change) => {
    const f = fixture();
    f.wait.mockImplementationOnce(async () => {
      if (change === "changed-target") f.files.set("target", "peer");
      if (change === "changed-stage") f.files.set("stage", "peer");
      if (change === "missing-stage") f.files.delete("stage");
      if (change === "unreadable") f.read.mockRejectedValueOnce(new Error("unreadable"));
    });
    await expect(f.run()).rejects.toBe(f.denied);
    expect(f.rename).toHaveBeenCalledTimes(1);
  },
);
it.each(["non-Windows", "other-error"])(
  "keeps the original single-attempt behavior for %s",
  async (kind) => {
    const f = fixture();
    if (kind === "non-Windows") f.ports.windows = false;
    else f.denied.code = "EIO";
    await expect(f.run()).rejects.toBe(f.denied);
    expect(f.rename).toHaveBeenCalledTimes(1);
    expect(f.wait).not.toHaveBeenCalled();
  },
);
