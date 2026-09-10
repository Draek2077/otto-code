import { describe, expect, it, vi } from "vitest";
import { createGitHostingProviderForgeAdapter, createGitHostingForgeAdapter } from "./router.js";
import type { ForgeService } from "../forge-service.js";

describe("createGitHostingProviderForgeAdapter", () => {
  it("pins a Forge adapter to its configured hosting provider", async () => {
    const bitbucket = {
      getCurrentPullRequestStatus: vi.fn(async () => null),
    };
    const resolver = {
      resolveForCwd: vi.fn(),
      resolveForProvider: vi.fn(() => ({
        providerId: "bitbucket-cloud" as const,
        capabilities: {},
        service: bitbucket,
        credentialsMissing: false as const,
      })),
      invalidate: vi.fn(),
      dispose: vi.fn(),
    };
    const adapter = createGitHostingProviderForgeAdapter(resolver as never, "bitbucket-cloud");

    await adapter.getCurrentPullRequestStatus({ cwd: "/repo", headRef: "feature" });

    expect(resolver.resolveForProvider).toHaveBeenCalledWith("bitbucket-cloud");
    expect(resolver.resolveForCwd).not.toHaveBeenCalled();
    expect(bitbucket.getCurrentPullRequestStatus).toHaveBeenCalledWith({
      cwd: "/repo",
      headRef: "feature",
    });
  });
});

describe("connection-aware poll subscription", () => {
  it("rebinds and ignores callbacks from the previously selected connection", async () => {
    type Poll = Parameters<NonNullable<ForgeService["retainCurrentPullRequestStatusPoll"]>>[0];
    let firstPoll: Poll;
    let nextPoll: Poll;
    let changed: () => void;
    const stopFirst = vi.fn();
    const stopNext = vi.fn();
    const serviceFor = vi
      .fn()
      .mockResolvedValueOnce({
        retainCurrentPullRequestStatusPoll: (p: Poll) => {
          firstPoll = p;
          return { unsubscribe: stopFirst };
        },
      })
      .mockResolvedValue({
        retainCurrentPullRequestStatusPoll: (p: Poll) => {
          nextPoll = p;
          return { unsubscribe: stopNext };
        },
      });
    const adapter = createGitHostingForgeAdapter({
      serviceFor,
      invalidate: vi.fn(),
      dispose: vi.fn(),
      onChange: (listener) => {
        changed = listener;
        return vi.fn();
      },
    });
    const onStatus = vi.fn();
    const onError = vi.fn();
    const subscription = adapter.retainCurrentPullRequestStatusPoll!({
      cwd: "/repo",
      headRef: "main",
      onStatus,
      onError,
    });
    await vi.waitFor(() => expect(serviceFor).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    changed!();
    await Promise.resolve();
    firstPoll!.onStatus?.(null);
    firstPoll!.onError?.(new Error("old account"));
    expect(onStatus).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    nextPoll!.onStatus?.(null);
    expect(onStatus).toHaveBeenCalledOnce();
    expect(stopFirst).toHaveBeenCalledOnce();
    subscription.unsubscribe();
    nextPoll!.onStatus?.(null);
    expect(stopNext).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenCalledOnce();
  });

  it("ignores a late resolution error from a superseded connection", async () => {
    let rejectOld: (error: Error) => void;
    let changed: () => void;
    const old = new Promise<ForgeService>((_resolve, reject) => {
      rejectOld = reject;
    });
    const serviceFor = vi.fn().mockReturnValueOnce(old).mockResolvedValue({});
    const adapter = createGitHostingForgeAdapter({
      serviceFor,
      invalidate: vi.fn(),
      dispose: vi.fn(),
      onChange: (listener) => {
        changed = listener;
        return vi.fn();
      },
    });
    const onError = vi.fn();
    const subscription = adapter.retainCurrentPullRequestStatusPoll!({
      cwd: "/repo",
      headRef: "main",
      onError,
      onStatus: vi.fn(),
    });
    changed!();
    rejectOld!(new Error("old account"));
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });
});
