import { z } from "zod";
import { failure, ProjectTargetSchema, type ProjectTarget, type Result } from "../shared/model.js";
import type { GitHubTarget, ProjectSnapshot } from "./ports.js";

const RecordSchema = z.object({ kanban: ProjectTargetSchema.nullish() }).passthrough();
const InputSchema = ProjectTargetSchema.pick({
  adapter: true,
  boardId: true,
  boardOwner: true,
}).strict();
const ownerPattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/;
const secretPattern = /^(?:gh[pousr]_|github_pat_|ATATT|ATCTT|xox)/i;

interface BoardPointer {
  boardId: string | null;
  boardOwner?: string;
}

function parseBoardUrl(raw: string): Result<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return failure("invalid_target", "Enter a valid board URL.");
  }
  if (url.username || url.password || url.port) {
    return failure("invalid_target", "Enter a board URL without credentials or a port.");
  }
  return { ok: true, value: url };
}

function githubUrlPointer(url: URL, owner: string | undefined): Result<BoardPointer> {
  const match = /^\/(?:orgs|users)\/([^/]+)\/projects\/([1-9]\d*)(?:\/views\/[1-9]\d*)?\/?$/.exec(
    url.pathname,
  );
  if (url.hostname !== "github.com" || !match) {
    return failure("invalid_target", "Enter a GitHub Projects URL or board identifier.");
  }
  if (owner && owner.toLowerCase() !== match[1]!.toLowerCase()) {
    return failure("invalid_target", "The board owner and URL identify different accounts.");
  }
  return { ok: true, value: { boardId: match[2]!, boardOwner: match[1]! } };
}

function jiraUrlPointer(url: URL, owner: string | undefined): Result<BoardPointer> {
  const match = /\/(?:boards|b)\/([1-9]\d*)(?:\/|$)/.exec(url.pathname);
  const candidate = match?.[1] ?? url.searchParams.get("rapidView");
  if (!url.hostname.endsWith(".atlassian.net") || !candidate || !/^[1-9]\d*$/.test(candidate)) {
    return failure("invalid_target", "Enter a Jira Cloud board URL or numeric board identifier.");
  }
  return { ok: true, value: { boardId: candidate, boardOwner: owner } };
}

function parsePointer(input: {
  adapter: ProjectTarget["adapter"];
  raw: string;
  owner?: string;
}): Result<BoardPointer> {
  if (!input.raw.startsWith("https://")) {
    return { ok: true, value: { boardId: input.raw || null, boardOwner: input.owner } };
  }
  const url = parseBoardUrl(input.raw);
  if (!url.ok) return url;
  return input.adapter === "github"
    ? githubUrlPointer(url.value, input.owner)
    : jiraUrlPointer(url.value, input.owner);
}

function validateGithubBoardId(boardId: string | null): Result<string | null> {
  if (!boardId) return { ok: true, value: boardId };
  if (!/^[A-Za-z0-9_=-]+$/.test(boardId)) {
    return failure(
      "invalid_target",
      "Enter a GitHub board number, node identifier or Projects URL.",
    );
  }
  if (/^\d+$/.test(boardId) && (!/^[1-9]\d*$/.test(boardId) || Number(boardId) > 2147483647)) {
    return failure("invalid_target", "Enter a valid GitHub board number.");
  }
  return { ok: true, value: boardId };
}

function validatePointer(
  adapter: ProjectTarget["adapter"],
  pointer: BoardPointer,
): Result<ProjectTarget> {
  const { boardId, boardOwner } = pointer;
  if (boardOwner && !ownerPattern.test(boardOwner)) {
    return failure("invalid_target", "Enter a GitHub user or organization name.");
  }
  if (adapter === "jira") {
    if (!boardId || !/^[1-9]\d*$/.test(boardId) || boardOwner) {
      return failure("invalid_target", "Enter a numeric Jira board identifier.");
    }
  } else {
    const valid = validateGithubBoardId(boardId);
    if (!valid.ok) return valid;
  }
  return { ok: true, value: { adapter, boardId, ...(boardOwner ? { boardOwner } : {}) } };
}

export function normalizeTarget(input: unknown): Result<ProjectTarget> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) return failure("invalid_target", "Enter a board identifier and provider.");
  const { adapter } = parsed.data;
  const raw = (parsed.data.boardId ?? "").trim();
  if (raw.length > 200 || secretPattern.test(raw)) {
    return failure("invalid_target", "Enter a board identifier, not a credential.");
  }
  const pointer = parsePointer({
    adapter,
    raw,
    owner: parsed.data.boardOwner?.trim() || undefined,
  });
  return pointer.ok ? validatePointer(adapter, pointer.value) : pointer;
}

export function readProjectTarget(record: unknown): Result<ProjectTarget | null> {
  const parsed = RecordSchema.safeParse(record);
  if (!parsed.success)
    return failure("invalid_settings", "The preserved project settings could not be read.");
  const saved = parsed.data.kanban;
  if (!saved) return { ok: true, value: null };
  const normalized = normalizeTarget({
    adapter: saved.adapter,
    boardId: saved.boardId,
    boardOwner: saved.boardOwner,
  });
  if (!normalized.ok)
    return failure(
      "invalid_settings",
      "The preserved board target needs review in Project Settings.",
    );
  return normalized;
}

// Call inside the host's project-record lock, with its freshly read revision.
// This pure helper never writes a file or repairs corrupt records implicitly.
export function prepareTargetUpdate(input: {
  snapshot: ProjectSnapshot;
  expectedRevision: string;
  target: unknown;
}): Result<Record<string, unknown>> {
  if (input.snapshot.revision !== input.expectedRevision) {
    return failure("revision_conflict", "Project Settings changed. Reload before saving.");
  }
  const parsed = RecordSchema.safeParse(input.snapshot.record);
  const previous = readProjectTarget(input.snapshot.record);
  if (!parsed.success || !previous.ok) {
    return failure("invalid_settings", "The preserved project settings could not be updated.");
  }
  if (input.target === null) return { ok: true, value: { ...parsed.data, kanban: null } };
  const target = normalizeTarget(input.target);
  if (!target.ok) return target;
  const {
    adapter: _adapter,
    boardId: _boardId,
    boardOwner: _owner,
    ...unknownFields
  } = parsed.data.kanban ?? {};
  return { ok: true, value: { ...parsed.data, kanban: { ...unknownFields, ...target.value } } };
}

export function resolveGitHubTarget(input: {
  target: ProjectTarget;
  remote: ProjectSnapshot["githubRemote"];
}): Result<GitHubTarget> {
  const { target, remote } = input;
  if (target.adapter !== "github")
    return failure("unsupported", "Jira board reads are not available in this slice.");
  if (!target.boardId) {
    return remote
      ? { ok: true, value: { kind: "repository", ...remote } }
      : failure("invalid_target", "Choose a GitHub board in Project Settings.");
  }
  if (!/^\d+$/.test(target.boardId))
    return { ok: true, value: { kind: "node", id: target.boardId } };
  const owner = target.boardOwner || remote?.owner;
  if (!owner)
    return failure(
      "invalid_target",
      "A board number needs its owner or a GitHub repository remote.",
    );
  return { ok: true, value: { kind: "number", owner, number: Number(target.boardId) } };
}
