import { LRUCache } from "lru-cache";
import { parseGitRemoteLocation } from "@getpaseo/protocol/git-remote";
import { resolveSshHostname } from "../../../utils/ssh-hostname.js";
import { defaultResolveRemoteUrl } from "../../forge-cli-command.js";
import {
  BitbucketError,
  bitbucketNumber,
  bitbucketPath,
  bitbucketText,
  createBitbucketHttp,
  type BitbucketCredential,
} from "./http.js";
import {
  PullRequest,
  CommitStatus,
  commitCheck,
  status,
  type BitbucketRepositoryIdentity,
} from "./models.js";
import type { CurrentPullRequestStatus, ForgeReadOptions } from "../../forge-service.js";

export interface BitbucketServicePorts {
  credential: (cwd: string) => Promise<BitbucketCredential | null>;
  resolveRemoteUrl?: (cwd: string) => Promise<string | null>;
  resolveSshHostname?: (host: string) => Promise<string | null>;
  fetch?: typeof fetch;
  now?: () => number;
}
export function createBitbucketReads(ports: BitbucketServicePorts) {
  const now = ports.now ?? Date.now;
  const cache = new LRUCache<string, { until: number; promise: Promise<unknown> }>({ max: 256 });
  const transports = new LRUCache<string, ReturnType<typeof createBitbucketHttp>>({ max: 32 });
  async function scope(cwd: string) {
    const remote = await (ports.resolveRemoteUrl ?? defaultResolveRemoteUrl)(cwd);
    const location = remote ? parseGitRemoteLocation(remote) : null;
    if (!location)
      throw new BitbucketError(
        "invalid",
        "This workspace has no supported Bitbucket Cloud remote.",
      );
    let host = location.host;
    if (
      host !== "bitbucket.org" &&
      host !== "altssh.bitbucket.org" &&
      (location.transport === "scp" || location.transport === "ssh")
    )
      host = (await (ports.resolveSshHostname ?? resolveSshHostname)(host)) ?? host;
    const parts = location.path.split("/");
    if (
      (host !== "bitbucket.org" && host !== "altssh.bitbucket.org") ||
      parts.length !== 2 ||
      (location.port !== undefined &&
        !(
          host === "altssh.bitbucket.org" &&
          location.transport === "ssh" &&
          location.port === "443"
        ))
    )
      throw new BitbucketError(
        "invalid",
        "This workspace has no supported Bitbucket Cloud remote.",
      );
    const identity: BitbucketRepositoryIdentity = { workspace: parts[0], repository: parts[1] };
    const path = bitbucketPath(identity.workspace, identity.repository);
    const credential = await ports.credential(cwd);
    if (!credential)
      throw new BitbucketError(
        "credentials",
        "Configure a Bitbucket account in this host's Git connections settings.",
      );
    let http = transports.get(credential.revision);
    if (!http) {
      http = createBitbucketHttp({ credential, fetch: ports.fetch, now });
      transports.set(credential.revision, http);
    }
    return { identity, path, http, key: JSON.stringify([credential.revision, path]) };
  }
  async function read<T>(
    cwd: string,
    operation: string,
    options: ForgeReadOptions,
    load: (context: Awaited<ReturnType<typeof scope>>) => Promise<T>,
  ): Promise<T> {
    if (options.force && !options.reason?.trim())
      throw new BitbucketError("invalid", "A forced Bitbucket read requires a reason.");
    const context = await scope(cwd);
    const key = JSON.stringify([context.key, operation]);
    const existing = cache.get(key);
    if (!options.force && existing && existing.until > now()) return (await existing.promise) as T;
    const promise = load(context);
    const entry = { until: now() + 30_000, promise };
    cache.set(key, entry);
    try {
      return await promise;
    } catch (error) {
      if (cache.get(key) === entry) cache.delete(key);
      throw error;
    }
  }
  async function pull(context: Awaited<ReturnType<typeof scope>>, number: number) {
    const raw = await context.http.request(
      "GET",
      `${context.path}/pullrequests/${bitbucketNumber(number)}`,
    );
    const parsed = PullRequest.safeParse(raw);
    if (!parsed.success)
      throw new BitbucketError("invalid", "Bitbucket returned an invalid pull request.");
    return parsed.data;
  }
  async function current(
    input: {
      cwd: string;
      headRef: string;
      headSha?: string;
      headRepositoryOwner?: string;
    } & ForgeReadOptions,
  ): Promise<CurrentPullRequestStatus | null> {
    return read(
      input.cwd,
      JSON.stringify(["current", input.headRef, input.headSha, input.headRepositoryOwner]),
      input,
      async (context) => {
        const q = new URLSearchParams({
          q: `source.branch.name="${bitbucketText(input.headRef)}"`,
          sort: "-updated_on",
          pagelen: "50",
          state: "OPEN,MERGED,DECLINED,SUPERSEDED",
        });
        // Repeated state parameters are required by Bitbucket's list contract.
        q.delete("state");
        for (const value of ["OPEN", "MERGED", "DECLINED", "SUPERSEDED"]) q.append("state", value);
        const rows = await context.http.page(`${context.path}/pullrequests?${q}`, PullRequest, 200);
        if (rows.truncated)
          throw new BitbucketError(
            "invalid",
            "Too many matching Bitbucket pull requests. Narrow the repository or branch selection.",
          );
        const pr = rows.values.find(
          (row) =>
            row.source.branch.name === input.headRef &&
            (row.state === "OPEN" || !input.headSha || row.source.commit?.hash === input.headSha) &&
            (!input.headRepositoryOwner ||
              row.source.repository?.full_name.split("/")[0] === input.headRepositoryOwner),
        );
        if (!pr) return null;
        const checks = await context.http.page(
          `${context.path}/pullrequests/${pr.id}/statuses?pagelen=100`,
          CommitStatus,
          500,
        );
        if (checks.truncated)
          throw new BitbucketError(
            "invalid",
            "Bitbucket returned more checks than Otto can display safely.",
          );
        return status(pr, context.identity, checks.values.map(commitCheck));
      },
    );
  }
  return {
    scope,
    read,
    pull,
    current,
    invalidate() {
      cache.clear();
    },
    dispose() {
      cache.clear();
      transports.clear();
    },
  };
}
export type BitbucketReads = ReturnType<typeof createBitbucketReads>;
