import { expect, it } from "vitest";
import { createBitbucketCloneInitializer } from "./clone";
import { backAddProjectPage } from "@/add-project-flow/model";
import type { AddProjectHost } from "@/add-project-flow/model";
const host: AddProjectHost = {
  serverId: "host",
  label: "Host",
  canAddProject: true,
  canBrowse: true,
  canCloneGithubRepositories: true,
  canSearchGithubRepositories: false,
  canCreateDirectory: true,
};
const repository = {
  id: "work/report",
  nameWithOwner: "work/report",
  cloneUrl: "git@bitbucket.org:work/report.git",
  description: null,
  updatedAt: null,
};
it("uses the existing host destination page for a complete Bitbucket remote", () => {
  const flow = createBitbucketCloneInitializer("host", repository).open([host]);
  expect(flow.pages.at(-1)).toMatchObject({ kind: "github-location", hostId: "host", repository });
});
it("never routes a selected repository into another host", () => {
  const flow = createBitbucketCloneInitializer("missing", repository).open([host]);
  expect(flow.pages.some((page) => page.kind === "github-location")).toBe(false);
});
it("consumes a late-capability clone once and preserves the user's Back navigation", () => {
  const model = createBitbucketCloneInitializer("host", repository);
  const opened = model.open([]);
  expect(opened.pages.at(-1)?.kind).toBe("host");
  const ready = model.apply(opened, [host]);
  expect(ready.pages.at(-1)).toMatchObject({ kind: "github-location", repository });
  const back = backAddProjectPage(ready);
  if (!back) throw new Error("Expected the underlying method page");
  expect(model.apply(back, [host]).pages.at(-1)?.kind).toBe("method");
});
