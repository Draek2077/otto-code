import { expect, it } from "vitest";
import { createBitbucketRepositories } from "./repositories.js";
const repository = {
  full_name: "work/report",
  name: "Report",
  is_private: true,
  description: "Work",
};
it("discovers workspaces through the current user-workspaces route without obsolete permissions APIs", async () => {
  const urls: string[] = [];
  const api = createBitbucketRepositories({
    credential: async () => ({ email: "test@example.test", apiToken: "private", revision: "a" }),
    fetch: async (url) => {
      urls.push(String(url));
      return Response.json({
        values: [{ administrator: true, workspace: { slug: "work", name: "Work" } }],
      });
    },
  });
  expect(await api.workspaces()).toEqual({
    workspaces: [{ id: "work", label: "Work", administrator: true }],
    truncated: false,
  });
  expect(urls).toEqual(["https://api.bitbucket.org/2.0/user/workspaces?pagelen=50"]);
});
it("searches the explicitly selected workspace and returns credential-free clone URLs", async () => {
  const urls: string[] = [];
  const api = createBitbucketRepositories({
    credential: async () => ({ email: "test@example.test", apiToken: "private", revision: "a" }),
    fetch: async (url) => {
      urls.push(String(url));
      return Response.json({ values: [repository] });
    },
  });
  expect(await api.list("work", 'report" OR private=false')).toMatchObject({
    truncated: false,
    repositories: [
      {
        cloneUrl: "https://bitbucket.org/work/report.git",
        sshUrl: "git@bitbucket.org:work/report.git",
      },
    ],
  });
  expect(new URL(urls[0]).searchParams.get("q")).toBe('name~"report\\" OR private=false"');
});
it("creates a repository exactly once with an explicit privacy choice", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const api = createBitbucketRepositories({
    credential: async () => ({ email: "test@example.test", apiToken: "private", revision: "a" }),
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json(repository);
    },
  });
  expect(
    await api.create({
      workspace: "work",
      name: "Work Report",
      description: "Work",
      private: true,
    }),
  ).toMatchObject({ fullName: "work/report", private: true });
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("https://api.bitbucket.org/2.0/repositories/work/work-report");
  expect(JSON.parse(String(requests[0].init?.body))).toEqual({
    scm: "git",
    name: "Work Report",
    description: "Work",
    is_private: true,
  });
});
it("does not retry repository creation after disconnect or report an unconfirmed success", async () => {
  let requests = 0;
  const api = createBitbucketRepositories({
    credential: async () => ({ email: "test@example.test", apiToken: "private", revision: "a" }),
    fetch: async () => {
      requests++;
      throw new Error("Disconnected");
    },
  });
  await expect(
    api.create({ workspace: "work", name: "Report", description: "", private: true }),
  ).rejects.toMatchObject({ kind: "uncertain" });
  expect(requests).toBe(1);
});
