import { z } from "zod";
import type { AgentSession, AgentSessionConfig } from "../../agent/agent-sdk-types.js";
import type { ProviderSnapshotManager } from "../../agent/provider-snapshot-manager.js";
import {
  getStructuredAgentResponse,
  type StructuredGenerationProvider,
} from "../../agent/agent-response-loop.js";
import type { ArtifactSelection } from "@getpaseo/plugin/otto/artifacts";
import { cleanupArtifactOperation, ArtifactError } from "./files.js";

export interface ArtifactCompletionRequest {
  cwd: string;
  prompt: string;
  selection?: z.infer<typeof ArtifactSelection>;
  signal: AbortSignal;
}
export interface ArtifactCompletionPorts {
  providers: Pick<ProviderSnapshotManager, "getAgentManagerProviderState" | "resolveCreateConfig">;
  resolveRole?: import("../agent-profiles/role-selection.js").ResolveRole;
  profileBrief?(id: string, cwd: string): Promise<string | null>;
  candidates(cwd: string): Promise<readonly StructuredGenerationProvider[]>;
}
interface CompletionFormat<T> {
  schema: z.ZodType<T>;
  schemaName: string;
  title: string;
  systemPrompt: string;
}
/** One fresh-session owner for HTML generation and data-only completion. Neither resumes user chats.
 * Native startup customizations keep normal provider semantics; this does not activate the parked
 * read-only/isolation investigation. No Otto tool catalog is attached and surfaced permissions are denied. */
export function createArtifactCompletion<T>(
  ports: ArtifactCompletionPorts,
  format: CompletionFormat<T>,
) {
  return async (request: ArtifactCompletionRequest) => {
    request.signal.throwIfAborted();
    const selected = request.selection;
    const seat = selected?.profileId
      ? await ports.resolveRole?.("artificer", selected.profileId, request.cwd)
      : undefined;
    if (
      selected?.profileId &&
      (!seat || seat.model !== selected.model || seat.profile.provider !== selected.provider)
    )
      throw new ArtifactError("unavailable", "The Artificer changed. Select its current model.");
    const profileBrief = seat ? await ports.profileBrief?.(seat.profile.id, request.cwd) : null;
    const candidates = request.selection
      ? [request.selection]
      : await ports.candidates(request.cwd);
    for (const candidate of candidates) {
      request.signal.throwIfAborted();
      const client = ports.providers.getAgentManagerProviderState().clients[candidate.provider];
      if (!client) continue;
      const resolved = await ports.providers.resolveCreateConfig({
        cwd: request.cwd,
        provider: candidate.provider,
        requestedMode: undefined,
        featureValues: undefined,
        parent: null,
        unattended: true,
      });
      request.signal.throwIfAborted();
      const config: AgentSessionConfig = {
        provider: candidate.provider,
        model: candidate.model,
        ...resolved,
        cwd: request.cwd,
        internal: true,
        mcpServers: {},
        title: format.title,
        thinkingOptionId:
          seat?.profile.thinkingOptionId ??
          ("thinkingOptionId" in candidate ? candidate.thinkingOptionId : undefined),
        systemPrompt: [seat?.binding.prompt, profileBrief, format.systemPrompt]
          .filter(Boolean)
          .join("\n\n"),
      };
      const session = await client.createSession(config, {}, { persistSession: false });
      // A selected provider owns this attempt. Never fall through after admission.
      const value = await runArtifactCompletion(session, request, format);
      return { value, provider: candidate.provider, model: config.model ?? null };
    }
    throw new ArtifactError(
      "unavailable",
      request.selection
        ? "The selected generation provider is unavailable. Choose an available provider and model on the artifact form."
        : "Choose a generation model on the artifact form. This host has no usable generation default.",
    );
  };
}
async function runArtifactCompletion<T>(
  session: AgentSession,
  request: ArtifactCompletionRequest,
  format: CompletionFormat<T>,
) {
  let closing: Promise<void> | undefined;
  const close = () => (closing ??= session.close());
  const cancel = () => {
    void session.interrupt().catch(() => undefined);
    void close().catch(() => undefined);
  };
  const release = session.subscribe((event) => {
    if (event.type === "permission_requested")
      void session
        .respondToPermission(event.request.id, {
          behavior: "deny",
          message: "Artifact generation cannot request interactive approval.",
        })
        .catch(cancel);
  });
  request.signal.addEventListener("abort", cancel, { once: true });
  return cleanupArtifactOperation(
    async () => {
      request.signal.throwIfAborted();
      return getStructuredAgentResponse({
        prompt: request.prompt,
        schema: format.schema,
        schemaName: format.schemaName,
        maxRetries: 1,
        caller: async (prompt) => {
          request.signal.throwIfAborted();
          const result = await session.run(prompt);
          request.signal.throwIfAborted();
          if (result.canceled) throw new Error("Artifact generation was canceled.");
          return result.finalText;
        },
      });
    },
    async () => {
      request.signal.removeEventListener("abort", cancel);
      release();
      await close();
    },
  );
}
