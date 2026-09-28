import { findExecutable } from "../../executable-resolution/executable-resolution.js";
import { execCommand } from "../../utils/spawn.js";
import type { ForgeConnectionStore } from "../../services/git-hosting/connection-store.js";

/**
 * Reads the GitHub credential the `gh` CLI already holds.
 *
 * For a selected CLI Git connection, read its named gh account. With no saved
 * connection, retain the ambient gh account. Token connections use the vault.
 * GraphQL needs a bearer token because gh api graphql cannot express the
 * nullable typed variables in the move mutation.
 *
 * Every failure mode - gh not installed, signed out, prompting - resolves to
 * null. A missing credential is a configuration state the settings card
 * reports, not an error the board screen should throw on.
 */

const GH_TOKEN_TIMEOUT_MS = 10_000;

// Clear ambient token overrides only for a named account so --user selects it.
// The fallback keeps the ambient token used by older, unbound projects.
const GH_NAMED_ACCOUNT_ENV = {
  GH_TOKEN: "",
  GITHUB_TOKEN: "",
  GH_ENTERPRISE_TOKEN: "",
  GITHUB_ENTERPRISE_TOKEN: "",
} as const;

// A signed-out gh must not block the daemon on an interactive prompt.
const GH_CLI_ENV = {
  GH_PROMPT_DISABLED: "1",
  NO_COLOR: "1",
} as const;

export async function resolveGitHubCliToken(
  account?: string,
  host = "github.com",
): Promise<string | null> {
  const ghPath = await findExecutable("gh");
  if (!ghPath) {
    return null;
  }
  try {
    const { stdout } = await execCommand(
      ghPath,
      ["auth", "token", "--hostname", host, ...(account ? ["--user", account] : [])],
      {
        envOverlay: { ...GH_CLI_ENV, ...(account ? GH_NAMED_ACCOUNT_ENV : {}) },
        timeout: GH_TOKEN_TIMEOUT_MS,
      },
    );
    const token = stdout.trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export interface KanbanGitHubCredential {
  token: string | null;
  account?: string;
  method?: "cli" | "token";
}

/** Resolve the project's selected identity without changing gh's active account. */
export async function resolveKanbanGitHubCredential(
  connections: ForgeConnectionStore | undefined,
  projectId: string | undefined,
): Promise<KanbanGitHubCredential> {
  const selected = connections?.selectedCredential("github", "github.com", projectId ?? null);
  if (!selected) return { token: await resolveGitHubCliToken() };
  const { connection, readSecret } = selected;
  if (connection.method === "cli") {
    const token = await resolveGitHubCliToken(connection.account, connection.host);
    if (!token)
      throw new Error(
        `Reconnect ${connection.label} in Git connections. The ${connection.account} CLI login is unavailable.`,
      );
    return { token, account: connection.account, method: "cli" };
  }
  return { token: await readSecret(), account: connection.account, method: "token" };
}
