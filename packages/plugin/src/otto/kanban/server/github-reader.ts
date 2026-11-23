import { invalidResponse, readGitHubBoard } from "./github-board.js";
import { z } from "zod";
import {
  failure,
  ProjectBindingSchema,
  type ProjectBinding,
  type Result,
} from "../shared/model.js";
import type { BoardReader, GitHubReadPort, GitHubTarget } from "./ports.js";
import { discoverRepositoryDocument, resolveNumberDocument } from "./github-documents.js";

const IdSchema = z.object({ id: z.string().min(1) });
const EnvelopeSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(z.object({ type: z.string().optional(), message: z.string() })).optional(),
});

// No credential lookup, command, network request, subscriptions or timers run
// during construction. The host bridge supplies an already-authorized read port.
export function createGitHubReader(port: GitHubReadPort): BoardReader {
  async function query(
    binding: ProjectBinding,
    document: string,
    variables: Record<string, string | number | null>,
  ): Promise<Result<unknown>> {
    const response = await port.query({ binding, document, variables });
    if (!response.ok) return response;
    const envelope = EnvelopeSchema.safeParse(response.value);
    if (!envelope.success) return invalidResponse();
    if (envelope.data.errors?.length) {
      const types = new Set(envelope.data.errors.map((error) => error.type));
      if (types.has("RATE_LIMITED"))
        return failure("rate_limited", "GitHub's read limit was reached. Retry later.");
      if (types.has("INSUFFICIENT_SCOPES"))
        return failure(
          "scope_required",
          "The host's GitHub CLI needs read:project access; private contents also need repo access.",
        );
      if (types.has("FORBIDDEN"))
        return failure("access_denied", "The host's GitHub account cannot access this board.");
      if (types.has("NOT_FOUND"))
        return failure("not_found", "The configured GitHub board is missing or inaccessible.");
      return failure("unavailable", "GitHub could not read the board. Retry on its owning host.");
    }
    return { ok: true, value: envelope.data.data };
  }

  async function resolve(binding: ProjectBinding, target: GitHubTarget): Promise<Result<string>> {
    if (target.kind === "node") return { ok: true, value: target.id };
    if (target.kind === "number") {
      const response = await query(binding, resolveNumberDocument, {
        owner: target.owner,
        number: target.number,
      });
      if (!response.ok) return response;
      const parsed = z
        .object({ repositoryOwner: z.object({ projectV2: IdSchema.nullable() }).nullable() })
        .safeParse(response.value);
      if (!parsed.success) return invalidResponse();
      const id = parsed.data.repositoryOwner?.projectV2?.id;
      return id
        ? { ok: true, value: id }
        : failure("not_found", "The configured GitHub board is missing or inaccessible.");
    }
    const response = await query(binding, discoverRepositoryDocument, {
      owner: target.owner,
      repository: target.repository,
    });
    if (!response.ok) return response;
    const parsed = z
      .object({
        repository: z
          .object({
            projectsV2: z.object({
              nodes: z.array(IdSchema).max(2),
              totalCount: z.number().int().nonnegative(),
            }),
          })
          .nullable(),
      })
      .safeParse(response.value);
    if (!parsed.success) return invalidResponse();
    const boards = parsed.data.repository?.projectsV2;
    if (!boards || boards.totalCount === 0)
      return failure(
        "not_found",
        "No accessible board is linked to this project's GitHub repository.",
      );
    if (boards.totalCount !== 1)
      return failure(
        "invalid_target",
        "Several boards are linked. Choose a board in Project Settings.",
      );
    const id = boards.nodes[0]?.id;
    return id ? { ok: true, value: id } : invalidResponse();
  }

  return {
    async read({ binding, target }) {
      if (!ProjectBindingSchema.safeParse(binding).success || binding.hostId !== port.hostId) {
        return failure("wrong_host", "Read this board on its project's owning host.");
      }
      try {
        const id = await resolve(binding, target);
        return id.ok ? await readGitHubBoard({ query, binding, id: id.value }) : id;
      } catch {
        // A transport must return safe errors. Never expose thrown CLI output,
        // headers, credentials or vendor error bodies across the plugin wire.
        return failure("unavailable", "The owning host could not read GitHub. Retry later.");
      }
    },
  };
}
