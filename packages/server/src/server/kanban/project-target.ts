/**
 * Normalization and validation for a project's Kanban board target.
 *
 * The target is a pointer, never a credential. That is the whole reason it can
 * live in the project record in the clear, so this module's most important job
 * is keeping it that way: a value that looks like a token is rejected outright
 * rather than quietly persisted somewhere that is not masked.
 *
 * Pure and session-free so it can be tested without a daemon.
 */

export type KanbanAdapter = "github" | "jira";

export interface KanbanProjectTargetInput {
  adapter: KanbanAdapter;
  boardId?: string | null;
}

export interface NormalizedKanbanProjectTarget {
  adapter: KanbanAdapter;
  /** Null on the github adapter means "derive from the project's git remote". */
  boardId: string | null;
  /** GitHub owner parsed from a Projects URL, when the target is a board number. */
  boardOwner?: string;
}

export type NormalizeKanbanProjectTargetResult =
  | { ok: true; target: NormalizedKanbanProjectTarget }
  | { ok: false; error: string };

/** No legitimate board id or URL is anywhere near this long. */
const MAX_BOARD_ID_LENGTH = 200;

/**
 * Prefixes of credentials people plausibly paste into the wrong field:
 * GitHub PATs and OAuth tokens, Atlassian API tokens, Slack tokens. Rejecting
 * them is a guardrail, not a security boundary - the real protection is that
 * nothing here is ever used as a credential.
 */
const TOKEN_PREFIXES = /^(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|ATATT|ATCTT|xox)/;

/** `https://github.com/orgs|users/<login>/projects/<number>` */
const GITHUB_PROJECT_URL = /\/(?:orgs|users)\/([^/]+)\/projects\/(\d+)/;
/** Jira board URLs: `/boards/<id>`, `/b/<id>/`, or `?rapidView=<id>`. */
const JIRA_BOARD_URL = /(?:\/boards\/|\/b\/|[?&]rapidView=)(\d+)/;

export function normalizeKanbanProjectTarget(
  input: KanbanProjectTargetInput,
): NormalizeKanbanProjectTargetResult {
  const raw = (input.boardId ?? "").trim();

  if (raw.length > MAX_BOARD_ID_LENGTH) {
    return { ok: false, error: "That board identifier is too long to be a board id or URL." };
  }
  if (TOKEN_PREFIXES.test(raw)) {
    return {
      ok: false,
      error:
        "That looks like an access token. This field takes a board id or URL only - " +
        "sign-in is configured once per host in Settings.",
    };
  }

  if (input.adapter === "jira") {
    const boardId = parseJiraBoardId(raw);
    if (!boardId) {
      // A Jira board is site-addressed and cannot be derived from anything, so
      // an empty value is a misconfiguration rather than a useful default.
      return { ok: false, error: "Enter a Jira board id." };
    }
    return { ok: true, target: { adapter: "jira", boardId } };
  }

  // GitHub: empty is the recommended default and means "use the boards on this
  // project's repository", which needs no input at all.
  const githubTarget = parseGitHubBoardTarget(raw);
  return {
    ok: true,
    target: {
      adapter: "github",
      boardId: githubTarget.boardId,
      ...(githubTarget.boardOwner ? { boardOwner: githubTarget.boardOwner } : {}),
    },
  };
}

function parseGitHubBoardTarget(raw: string): { boardId: string | null; boardOwner?: string } {
  if (!raw) {
    return { boardId: null };
  }
  const fromUrl = GITHUB_PROJECT_URL.exec(raw);
  if (fromUrl) {
    return { boardId: fromUrl[2], boardOwner: fromUrl[1] };
  }
  // A bare number or a GraphQL node id both pass through; the provider resolves
  // a number against the project's remote owner when the URL did not carry one.
  return { boardId: raw };
}

function parseJiraBoardId(raw: string): string | null {
  if (!raw) {
    return null;
  }
  const fromUrl = JIRA_BOARD_URL.exec(raw);
  if (fromUrl) {
    return fromUrl[1];
  }
  return /^\d+$/.test(raw) ? raw : null;
}
