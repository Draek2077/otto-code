import { findExecutable } from "../../executable-resolution/executable-resolution.js";
import { execCommand } from "../../utils/spawn.js";

/**
 * Reads the GitHub credential the `gh` CLI already holds.
 *
 * GitHub auth in Otto is owned by the gh CLI end to end - the git-hosting
 * GitHub service shells out to it, and the Kanban Projects v2 provider borrows
 * the same credential rather than adding a second token for the user to author
 * and rotate. `gh auth token` prints the OAuth token for the active host; the
 * Projects v2 GraphQL API then takes it as a bearer token, which is what the
 * provider needs (`gh api graphql` cannot express the nullable typed variables
 * the move mutation uses).
 *
 * Every failure mode - gh not installed, signed out, prompting - resolves to
 * null. A missing credential is a configuration state the settings card
 * reports, not an error the board screen should throw on.
 */

const GH_TOKEN_TIMEOUT_MS = 10_000;

// GH_PROMPT_DISABLED keeps a signed-out gh from blocking on an interactive
// prompt inside the daemon; NO_COLOR keeps the token free of escape codes.
const GH_TOKEN_ENV = {
  GH_PROMPT_DISABLED: "1",
  NO_COLOR: "1",
} as const;

export async function resolveGitHubCliToken(): Promise<string | null> {
  const ghPath = await findExecutable("gh");
  if (!ghPath) {
    return null;
  }
  try {
    const { stdout } = await execCommand(ghPath, ["auth", "token"], {
      envOverlay: GH_TOKEN_ENV,
      timeout: GH_TOKEN_TIMEOUT_MS,
    });
    const token = stdout.trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}
