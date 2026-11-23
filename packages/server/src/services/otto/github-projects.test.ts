import { expect, it } from "vitest";
import {
  createGitHubService,
  GitHubAuthenticationError,
  GitHubCommandError,
  GitHubCliMissingError,
} from "../github-service.js";
import {
  createKanbanHandlers,
  readFieldsDocument,
  resolveNumberDocument,
} from "@getpaseo/plugin/server/otto-kanban";
import type { ProjectSnapshot } from "@getpaseo/plugin/server/otto-kanban";

function fixture(reply: () => string = () => '{"data":{"node":null}}') {
  const calls: Array<{ args: string[]; cwd: string; envOverlay?: Record<string, string> }> = [];
  const service = createGitHubService({
    resolveGhPath: async () => "fixture-gh",
    resolveRepoHost: async () => "github.enterprise.example",
    resolveRepoSlug: async () => "owner/repository",
    runner: async (args, options) => {
      calls.push({ args, cwd: options.cwd, envOverlay: options.envOverlay });
      return { stdout: reply(), stderr: "" };
    },
  });
  return { port: service.projectBoards, calls };
}

it("uses the existing CLI host policy and preserves GraphQL string/integer/null types", async () => {
  const before = process.env.GH_HOST;
  const f = fixture();
  expect(
    await f.port.query({
      cwd: "/owning/project",
      document: resolveNumberDocument,
      variables: { owner: "123", number: 7, cursor: null },
    }),
  ).toEqual({ ok: true, value: { data: { node: null } } });
  expect(f.calls).toEqual([
    {
      cwd: "/owning/project",
      envOverlay: { GH_HOST: "github.enterprise.example" },
      args: [
        "api",
        "graphql",
        "-f",
        `query=${resolveNumberDocument}`,
        "-f",
        "owner=123",
        "-F",
        "number=7",
        "-F",
        "cursor=null",
      ],
    },
  ]);
  expect(process.env.GH_HOST).toBe(before);
});

it("resolves repository identity through the same offline policy without a CLI query", async () => {
  const f = fixture();
  expect(await f.port.repository("/owning/project")).toEqual({
    owner: "owner",
    repository: "repository",
  });
  expect(f.calls).toEqual([]);
});

it.each([
  'mutation { deleteProjectV2(input:{projectId:"PVT_x"}) { clientMutationId } }',
  "query { viewer { login } }",
])("rejects non-allowlisted documents before running a command (%s)", async (document) => {
  const f = fixture();
  expect(await f.port.query({ cwd: "/owning/project", document, variables: {} })).toMatchObject({
    ok: false,
    error: { code: "access_denied" },
  });
  expect(f.calls).toEqual([]);
});

it("rejects oversized variables before invoking the CLI", async () => {
  const f = fixture();
  expect(
    await f.port.query({
      cwd: "/owning/project",
      document: readFieldsDocument,
      variables: { id: "x".repeat(4097) },
    }),
  ).toMatchObject({ ok: false, error: { code: "access_denied" } });
  expect(f.calls).toEqual([]);
});

it.each([
  new GitHubAuthenticationError({ stderr: "private-token" }),
  new GitHubCliMissingError(),
  new Error("private-token"),
])("never exposes raw CLI/auth failures (%s)", async (error) => {
  const f = fixture(() => {
    throw error;
  });
  const result = await f.port.query({
    cwd: "/owning/project",
    document: readFieldsDocument,
    variables: { id: "PVT_x" },
  });
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain("private-token");
});

it("preserves official scope failures for the canonical reader without exposing vendor messages", async () => {
  const f = fixture(() => {
    throw new GitHubCommandError({
      args: [],
      cwd: "/owning/project",
      exitCode: 1,
      stderr: "private-token",
      stdout: JSON.stringify({
        errors: [{ type: "INSUFFICIENT_SCOPES", message: "private-token" }],
      }),
    });
  });
  const binding = { hostId: "host-a", projectId: "project-a" };
  const snapshot: ProjectSnapshot = {
    binding,
    revision: "r1",
    record: { kanban: { adapter: "github", boardId: "PVT_x" } },
    githubRemote: null,
  };
  const handlers = createKanbanHandlers({
    projects: {
      hostId: "host-a",
      read: async () => ({ ok: true, value: snapshot }),
      setTarget: async () => {
        throw new Error("No writes");
      },
    },
    github: {
      hostId: "host-a",
      query: (input) => f.port.query({ cwd: "/owning/project", ...input }),
    },
  });
  const result = await handlers.readBoard(binding);
  expect(result).toMatchObject({ status: "error", error: { code: "scope_required" } });
  expect(JSON.stringify(result)).not.toContain("private-token");
});

it("does not turn a nonzero command into success when its output has no GraphQL errors", async () => {
  const f = fixture(() => {
    throw new GitHubCommandError({
      args: [],
      cwd: "/owning/project",
      exitCode: 1,
      stderr: "private-token",
      stdout: '{"data":{"node":null}}',
    });
  });
  expect(
    await f.port.query({
      cwd: "/owning/project",
      document: readFieldsDocument,
      variables: { id: "PVT_x" },
    }),
  ).toMatchObject({ ok: false, error: { code: "unavailable" } });
});
