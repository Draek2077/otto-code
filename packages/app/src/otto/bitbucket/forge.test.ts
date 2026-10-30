import { expect, it } from "vitest";
import { bitbucketCloudForgeLogic } from "./forge";
import { buildForgeBlobUrl, buildForgeBranchTreeUrl } from "@/git/forge-url";
import { parseForgeRef } from "@/git/forge-refs";

it("offers supported merge methods without advertising auto-merge or queues", () => {
  expect(
    bitbucketCloudForgeLogic.facts.deriveMergeCapability({
      forge: "bitbucket",
      mergeStrategiesAllowed: ["merge", "squash", "rebase"],
      defaultMergeStrategy: "squash",
    }),
  ).toEqual({
    directMergeReady: true,
    canEnableAutoMerge: false,
    autoMergeEnabled: false,
    canDisableAutoMerge: false,
    mergeBlockedByQueue: false,
    allowedMethods: ["merge", "squash"],
    preferredMethod: "squash",
  });
});
it("builds real Bitbucket source links and canonicalizes its alternate SSH host", () => {
  expect(
    buildForgeBlobUrl("bitbucket-cloud", {
      remoteUrl: "ssh://git@altssh.bitbucket.org:443/team/repo.git",
      branch: "main",
      path: "src/work.ts",
      lineStart: 4,
      lineEnd: 8,
    }),
  ).toBe("https://bitbucket.org/team/repo/src/main/src/work.ts#lines-4:8");
  expect(
    buildForgeBranchTreeUrl("bitbucket-cloud", {
      remoteUrl: "git@bitbucket.org:team/repo.git",
      branch: "feature/work",
    }),
  ).toBe("https://bitbucket.org/team/repo/src/feature/work");
});
it("recognizes pasted PR attachments only for this exact repository", () => {
  expect(
    parseForgeRef(
      "https://bitbucket.org/team/repo/pull-requests/17",
      "git@bitbucket.org:team/repo.git",
    ),
  ).toEqual({ kind: "change_request", number: 17 });
  expect(
    parseForgeRef(
      "https://bitbucket.org/team/other/pull-requests/17",
      "git@bitbucket.org:team/repo.git",
    ),
  ).toBeNull();
});
