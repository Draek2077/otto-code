/** GitHub Projects reads borrow the normal daemon CLI runner and host policy. */
import {
  discoverRepositoryDocument,
  resolveNumberDocument,
  readFieldsDocument,
  readItemsDocument,
} from "@getpaseo/plugin/server/otto-kanban";
import { failure, type Result } from "@getpaseo/plugin/otto/kanban";
import {
  ForgeAuthenticationError,
  ForgeCliMissingError,
  ForgeCommandError,
} from "../forge-cli-command.js";
import { z } from "zod";

const DOCUMENTS = new Set([
  discoverRepositoryDocument,
  resolveNumberDocument,
  readFieldsDocument,
  readItemsDocument,
]);
const GraphqlErrors = z.object({
  errors: z.array(z.object({ message: z.string(), type: z.string().optional() })).min(1),
});
export interface GitHubProjectReads {
  repository(cwd: string): Promise<{ owner: string; repository: string } | null>;
  query(input: {
    cwd: string;
    document: string;
    variables: Record<string, string | number | null>;
  }): Promise<Result<unknown>>;
}
interface Ports {
  run(args: string[], options: { cwd: string }): Promise<string>;
  resolveRepository(cwd: string): Promise<string | null>;
}
function parseEnvelope(text: string): Result<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return failure("invalid_response", "GitHub returned an invalid Projects response.");
  }
}
function safeFailure(error: unknown): Result<unknown> {
  if (error instanceof ForgeAuthenticationError)
    return failure(
      "auth_required",
      "Sign in with GitHub CLI on the selected host. Projects reads need read:project access.",
    );
  if (error instanceof ForgeCliMissingError)
    return failure("unavailable", "Install GitHub CLI on the selected host and sign in there.");
  // gh exits nonzero on GraphQL errors but preserves the official error envelope.
  // The canonical reader classifies its typed errors, never CLI text or tokens.
  if (error instanceof ForgeCommandError && error.stdout) {
    const response = parseEnvelope(error.stdout);
    if (response.ok && GraphqlErrors.safeParse(response.value).success) return response;
  }
  return failure("unavailable", "GitHub Projects could not be read on the selected host.");
}
function queryArgs(
  document: string,
  variables: Record<string, string | number | null>,
): string[] | null {
  if (!DOCUMENTS.has(document)) return null;
  const args = ["api", "graphql", "-f", `query=${document}`];
  for (const [key, value] of Object.entries(variables)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) return null;
    if (typeof value === "string" && value.length > 4096) return null;
    if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
    // Official gh API flags retain string IDs (including numeric-looking IDs),
    // while -F supplies GraphQL integer/null variables without coercing strings.
    args.push(typeof value === "string" ? "-f" : "-F", `${key}=${value === null ? "null" : value}`);
  }
  return args;
}
export function createGitHubProjectReads(ports: Ports): GitHubProjectReads {
  return {
    async repository(cwd) {
      const slug = await ports.resolveRepository(cwd);
      if (!slug) return null;
      const parts = slug.split("/");
      if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
      return { owner: parts[0], repository: parts[1] };
    },
    async query({ cwd, document, variables }) {
      const args = queryArgs(document, variables);
      if (!args)
        return failure(
          "access_denied",
          "Only supported GitHub Projects read queries are available.",
        );
      try {
        return parseEnvelope(await ports.run(args, { cwd }));
      } catch (error) {
        return safeFailure(error);
      }
    },
  };
}
