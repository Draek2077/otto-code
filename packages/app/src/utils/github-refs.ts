import { parseBitbucketCloudRemoteUrl, parseGitHubRemoteUrl } from "@otto-code/protocol/git-remote";

export type GithubRefKind = "pull" | "issues";

export interface GithubRemote {
  owner: string;
  repo: string;
  host: "github.com" | "bitbucket.org";
}

export interface GithubRef {
  kind: GithubRefKind;
  number: number;
  owner: string;
  repo: string;
  url: string;
}

interface ParsedGithubUrl {
  kind: GithubRefKind;
  number: number;
  owner: string;
  repo: string;
}

const GITHUB_REF_URL_PATTERN =
  /https?:\/\/github\.com\/([^/\s<>)\]]+)\/([^/\s<>)\]]+)\/(pull|issues)\/(\d+)(?:[/?#][^\s<>)\]]*)?/giu;

// Bitbucket Cloud PR links: https://bitbucket.org/<workspace>/<repo>/pull-requests/<n>
const BITBUCKET_REF_URL_PATTERN =
  /https?:\/\/bitbucket\.org\/([^/\s<>)\]]+)\/([^/\s<>)\]]+)\/(pull-requests)\/(\d+)(?:[/?#][^\s<>)\]]*)?/giu;

export function normalizeGithubRemote(remoteUrl: string | null | undefined): GithubRemote | null {
  const trimmed = remoteUrl?.trim();
  if (!trimmed) {
    return null;
  }

  const github = parseGitHubRemoteUrl(trimmed);
  if (github) {
    return {
      owner: github.owner,
      repo: github.name,
      host: "github.com",
    };
  }

  const bitbucket = parseBitbucketCloudRemoteUrl(trimmed);
  if (bitbucket) {
    return {
      owner: bitbucket.owner,
      repo: bitbucket.name,
      host: "bitbucket.org",
    };
  }

  return null;
}

export function parseGithubRef(
  text: string | null | undefined,
  remoteUrl: string | null | undefined,
): GithubRef | null {
  return extractGithubRefs(text, remoteUrl)[0] ?? null;
}

export function extractGithubRefs(
  text: string | null | undefined,
  remoteUrl: string | null | undefined,
): GithubRef[] {
  const remote = normalizeGithubRemote(remoteUrl);
  const body = text?.trim();
  if (!remote || !body) {
    return [];
  }

  const refs: GithubRef[] = [];
  const seen = new Set<string>();
  const pattern =
    remote.host === "bitbucket.org" ? BITBUCKET_REF_URL_PATTERN : GITHUB_REF_URL_PATTERN;

  for (const match of body.matchAll(pattern)) {
    const parsed = parseGithubUrlMatch(match);
    if (!parsed || !matchesRemote(parsed, remote)) {
      continue;
    }

    const dedupeKey = `${parsed.kind}:${parsed.number}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    refs.push({
      kind: parsed.kind,
      number: parsed.number,
      owner: remote.owner,
      repo: remote.repo,
      url:
        remote.host === "bitbucket.org"
          ? `https://bitbucket.org/${remote.owner}/${remote.repo}/pull-requests/${parsed.number}`
          : `https://github.com/${remote.owner}/${remote.repo}/${parsed.kind}/${parsed.number}`,
    });
  }

  return refs;
}

function parseGithubUrlMatch(match: RegExpMatchArray): ParsedGithubUrl | null {
  const owner = match[1];
  const repo = match[2];
  const kind = match[3];
  const numberText = match[4];
  if (!owner || !repo || !isGithubRefSegment(kind) || !numberText) {
    return null;
  }

  const number = Number.parseInt(numberText, 10);
  if (!Number.isSafeInteger(number) || number <= 0) {
    return null;
  }

  // Bitbucket "pull-requests" segments map onto the PR ref kind.
  return { owner, repo, kind: kind === "issues" ? "issues" : "pull", number };
}

function isGithubRefSegment(value: string | undefined): value is string {
  return value === "pull" || value === "issues" || value === "pull-requests";
}

function matchesRemote(parsed: ParsedGithubUrl, remote: GithubRemote): boolean {
  return (
    parsed.owner.toLowerCase() === remote.owner.toLowerCase() &&
    parsed.repo.toLowerCase() === remote.repo.toLowerCase()
  );
}
