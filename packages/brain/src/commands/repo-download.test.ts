import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const activity = { update: vi.fn(), end: vi.fn() };
  return {
    activity,
    downloadRepoFiles: vi.fn(),
    withActivity: vi.fn(
      async (
        _kind: string,
        _options: unknown,
        run: (handle: typeof activity) => Promise<string[]>,
      ): Promise<string[]> => run(activity),
    ),
  };
});

vi.mock("../models/index.js", () => ({ downloadRepoFiles: mocks.downloadRepoFiles }));
vi.mock("../service/activity.js", () => ({ withActivity: mocks.withActivity }));

import { downloadRepoFilesWithProgress } from "./repo-download.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("downloadRepoFilesWithProgress", () => {
  it("reports progress to activity and emits a terminal 100 percent after success", async () => {
    mocks.downloadRepoFiles.mockImplementation(async ({ onProgress }) => {
      onProgress({ file: "model.gguf", receivedBytes: 997 });
      return ["C:/models/model.gguf"];
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(
      downloadRepoFilesWithProgress({
        activityTarget: "owner/repo (Q4_K_M)",
        progressLabel: "owner/repo Q4_K_M",
        totalBytes: 1000,
        repo: "owner/repo",
        files: ["model.gguf"],
        destRoot: "C:/models",
      }),
    ).resolves.toEqual(["C:/models/model.gguf"]);

    expect(mocks.withActivity).toHaveBeenCalledWith(
      "download",
      { target: "owner/repo (Q4_K_M)" },
      expect.any(Function),
    );
    expect(mocks.activity.update).toHaveBeenCalledWith(0.997);
    expect(stderr.mock.calls).toEqual([
      ["  owner/repo Q4_K_M: 99%\r"],
      ["  owner/repo Q4_K_M: 100%\r"],
      ["\n"],
    ]);
  });

  it("does not claim completion when the transfer fails", async () => {
    mocks.downloadRepoFiles.mockRejectedValue(new Error("network disconnected"));
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(
      downloadRepoFilesWithProgress({
        activityTarget: "owner/repo (Q4_K_M)",
        progressLabel: "owner/repo Q4_K_M",
        totalBytes: 1000,
        repo: "owner/repo",
        files: ["model.gguf"],
        destRoot: "C:/models",
      }),
    ).rejects.toThrow("network disconnected");

    expect(stderr).not.toHaveBeenCalled();
  });
});
