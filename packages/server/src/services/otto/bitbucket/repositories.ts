import { z } from "zod";
import type { BitbucketRepository } from "@getpaseo/plugin/otto/bitbucket-connections";
import {
  BitbucketError,
  bitbucketPath,
  bitbucketText,
  createBitbucketHttp,
  type BitbucketCredential,
} from "./http.js";

const Repository = z.object({
  full_name: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  is_private: z.boolean(),
  updated_on: z.string().nullish(),
});
const Workspace = z.object({
  administrator: z.boolean(),
  workspace: z.object({ slug: z.string().min(1).max(256), name: z.string().max(256).optional() }),
});
function project(value: z.infer<typeof Repository>): BitbucketRepository {
  const parts = value.full_name.split("/");
  if (parts.length !== 2)
    throw new BitbucketError("invalid", "Bitbucket returned an invalid repository identity.");
  bitbucketPath(parts[0], parts[1]);
  const repository = parts.map(encodeURIComponent).join("/");
  return {
    fullName: value.full_name,
    name: value.name,
    description: value.description ?? null,
    private: value.is_private,
    updatedAt: value.updated_on ?? null,
    cloneUrl: `https://bitbucket.org/${repository}.git`,
    sshUrl: `git@bitbucket.org:${value.full_name}.git`,
    url: `https://bitbucket.org/${repository}`,
  };
}
export function createBitbucketRepositories(ports: {
  credential: () => Promise<BitbucketCredential | null>;
  fetch?: typeof fetch;
}) {
  async function http() {
    const credential = await ports.credential();
    if (!credential)
      throw new BitbucketError("credentials", "Configure a Bitbucket account on this host.");
    return createBitbucketHttp({ credential, fetch: ports.fetch });
  }
  return {
    async workspaces() {
      // Current user-workspaces API replaces the retired cross-workspace permissions route.
      const page = await (await http()).page("/2.0/user/workspaces?pagelen=50", Workspace, 100);
      return {
        workspaces: page.values.map((row) => ({
          id: row.workspace.slug,
          label: row.workspace.name ?? row.workspace.slug,
          administrator: row.administrator,
        })),
        truncated: page.truncated,
      };
    },
    async list(workspace: string, query: string) {
      const params = new URLSearchParams({ pagelen: "50", sort: "-updated_on" });
      if (query.trim()) params.set("q", `name~"${bitbucketText(query.trim())}"`);
      const result = await (
        await http()
      ).page(`${bitbucketPath(workspace)}?${params}`, Repository, 100);
      return { repositories: result.values.map(project), truncated: result.truncated };
    },
    async create(input: {
      workspace: string;
      name: string;
      description: string;
      private: boolean;
    }) {
      const slug = input.name
        .trim()
        .toLowerCase()
        .replaceAll(/[^a-z0-9._-]+/g, "-")
        .replaceAll(/-{2,}/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "");
      if (!slug)
        throw new BitbucketError(
          "invalid",
          "Enter a repository name containing letters or numbers.",
        );
      const raw = await (
        await http()
      ).request("POST", bitbucketPath(input.workspace, slug), {
        scm: "git",
        name: input.name.trim(),
        description: input.description,
        is_private: input.private,
      });
      const parsed = Repository.safeParse(raw);
      if (!parsed.success)
        throw new BitbucketError(
          "uncertain",
          "The repository may have been created. Refresh Bitbucket before trying again.",
        );
      return project(parsed.data);
    },
  };
}
