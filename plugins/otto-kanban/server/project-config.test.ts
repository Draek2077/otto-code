import { describe, expect, it } from "vitest";
import {
  normalizeTarget,
  prepareTargetUpdate,
  readProjectTarget,
  resolveGitHubTarget,
} from "./project-config.js";
import type { ProjectSnapshot } from "./ports.js";

const binding = { hostId: "host-a", projectId: "project-a" };
const snapshot: ProjectSnapshot = {
  binding,
  revision: "r1",
  githubRemote: { owner: "remote-org", repository: "repo" },
  record: {
    projectId: "project-a",
    rootPath: "/repo",
    customName: "Keep me",
    knowledgeLocation: "host",
    futureFeature: { enabled: true },
    kanban: { adapter: "github", boardId: "12", boardOwner: "old-org", futureSetting: { keep: 1 } },
  },
};

describe("project-owned board configuration", () => {
  it("retains the owner from an organization URL, independent of the repository owner", () => {
    expect(
      normalizeTarget({
        adapter: "github",
        boardId: "https://github.com/orgs/shared/projects/42/views/1",
      }),
    ).toEqual({ ok: true, value: { adapter: "github", boardId: "42", boardOwner: "shared" } });
    expect(
      normalizeTarget({
        adapter: "github",
        boardId: " https://github.com/orgs/shared/projects/42 ",
      }),
    ).toEqual({ ok: true, value: { adapter: "github", boardId: "42", boardOwner: "shared" } });
    expect(
      resolveGitHubTarget({
        target: { adapter: "github", boardId: "42", boardOwner: "shared" },
        remote: snapshot.githubRemote,
      }),
    ).toEqual({ ok: true, value: { kind: "number", owner: "shared", number: 42 } });
  });

  it("reads old number-only settings with a deterministic project remote owner", () => {
    expect(readProjectTarget({ kanban: { adapter: "github", boardId: "12" } })).toEqual({
      ok: true,
      value: { adapter: "github", boardId: "12" },
    });
    expect(
      resolveGitHubTarget({
        target: { adapter: "github", boardId: "12" },
        remote: snapshot.githubRemote,
      }),
    ).toEqual({ ok: true, value: { kind: "number", owner: "remote-org", number: 12 } });
    expect(
      resolveGitHubTarget({ target: { adapter: "github", boardId: "12" }, remote: null }),
    ).toMatchObject({ ok: false, error: { code: "invalid_target" } });
  });

  it("keeps unconfigured and repository discovery as distinct states", () => {
    expect(readProjectTarget({ displayName: "Old project" })).toEqual({ ok: true, value: null });
    expect(readProjectTarget({ kanban: null })).toEqual({ ok: true, value: null });
    expect(readProjectTarget({ kanban: { adapter: "github" } })).toEqual({
      ok: true,
      value: { adapter: "github", boardId: null },
    });
    expect(
      resolveGitHubTarget({
        target: { adapter: "github", boardId: null },
        remote: snapshot.githubRemote,
      }),
    ).toEqual({ ok: true, value: { kind: "repository", owner: "remote-org", repository: "repo" } });
  });

  it("preserves opaque board node identities", () => {
    expect(
      resolveGitHubTarget({ target: { adapter: "github", boardId: "PVT_abc123" }, remote: null }),
    ).toEqual({ ok: true, value: { kind: "node", id: "PVT_abc123" } });
  });

  it("preserves Jira pointers without claiming a Jira read adapter", () => {
    expect(
      normalizeTarget({
        adapter: "jira",
        boardId: "https://team.atlassian.net/jira/software/projects/ABC/boards/25",
      }),
    ).toEqual({ ok: true, value: { adapter: "jira", boardId: "25" } });
    expect(
      normalizeTarget({
        adapter: "jira",
        boardId: "https://team.atlassian.net/secure/RapidBoard.jspa?rapidView=25",
      }),
    ).toEqual({ ok: true, value: { adapter: "jira", boardId: "25" } });
    expect(
      resolveGitHubTarget({ target: { adapter: "jira", boardId: "25" }, remote: null }),
    ).toMatchObject({ ok: false, error: { code: "unsupported" } });
  });

  it.each([
    { adapter: "github", boardId: "ghp_secret" },
    { adapter: "github", boardId: "github_pat_secret" },
    { adapter: "jira", boardId: "ATATTsecret" },
    { adapter: "github", boardId: "https://" },
    { adapter: "github", boardId: "https://github.com.evil/orgs/acme/projects/2" },
    { adapter: "github", boardId: "https://secret@github.com/orgs/acme/projects/2" },
    { adapter: "github", boardId: "https://github.com/orgs/acme/projects/2", boardOwner: "other" },
    { adapter: "github", boardId: "2147483648" },
    { adapter: "github", boardId: "0" },
    { adapter: "github", boardId: "3", token: "secret" },
    { adapter: "jira", boardId: "" },
    { adapter: "jira", boardId: "https://evil.test/boards/3" },
  ])("rejects invalid pointers without echoing their contents: %j", (input) => {
    const result = normalizeTarget(input);
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_target" } });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("updates only the selected target while preserving dormant and unknown fields", () => {
    const before = structuredClone(snapshot);
    expect(
      prepareTargetUpdate({
        snapshot,
        expectedRevision: "r1",
        target: { adapter: "github", boardId: "99" },
      }),
    ).toEqual({
      ok: true,
      value: {
        ...(snapshot.record as Record<string, unknown>),
        kanban: { adapter: "github", boardId: "99", futureSetting: { keep: 1 } },
      },
    });
    expect(snapshot).toEqual(before);
    expect(prepareTargetUpdate({ snapshot, expectedRevision: "r1", target: null })).toEqual({
      ok: true,
      value: { ...(snapshot.record as Record<string, unknown>), kanban: null },
    });
  });

  it("refuses stale revisions without preparing any replacement", () => {
    expect(prepareTargetUpdate({ snapshot, expectedRevision: "old", target: null })).toMatchObject({
      ok: false,
      error: { code: "revision_conflict" },
    });
  });

  it.each([
    null,
    [],
    "broken",
    { kanban: "broken" },
    { kanban: { adapter: "future", boardId: "7" } },
    { kanban: { adapter: "github", boardId: 7 } },
  ])("leaves corrupt or newer settings untouched: %j", (record) => {
    const before = structuredClone(record);
    expect(readProjectTarget(record)).toMatchObject({
      ok: false,
      error: { code: "invalid_settings" },
    });
    expect(
      prepareTargetUpdate({
        snapshot: { ...snapshot, record },
        expectedRevision: "r1",
        target: null,
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_settings" } });
    expect(record).toEqual(before);
  });

  it("does not impose a unique-owner constraint on a shared organization board", () => {
    const target = { adapter: "github", boardId: "https://github.com/orgs/shared/projects/2" };
    const first = prepareTargetUpdate({ snapshot, expectedRevision: "r1", target });
    const second = prepareTargetUpdate({
      snapshot: { ...snapshot, binding: { ...binding, projectId: "other" } },
      expectedRevision: "r1",
      target,
    });
    expect(first).toEqual(second);
  });
});
