import { z } from "zod";
import type { AgentSession, AgentSessionConfig } from "../../agent/agent-sdk-types.js";
import type { ProviderSnapshotManager } from "../../agent/provider-snapshot-manager.js";
import {
  getStructuredAgentResponse,
  type StructuredGenerationProvider,
} from "../../agent/agent-response-loop.js";
import type { ArtifactSelection } from "@getpaseo/plugin/otto/artifacts";
import { cleanupArtifactOperation } from "./files.js";

export interface ArtifactGenerationRequest {
  cwd: string;
  prompt: string;
  selection?: z.infer<typeof ArtifactSelection>;
  signal: AbortSignal;
}
export interface ArtifactGenerationResult {
  html: string;
  provider: string;
  model: string | null;
}
export type ArtifactGeneration = (
  request: ArtifactGenerationRequest,
) => Promise<ArtifactGenerationResult>;
type Providers = Pick<
  ProviderSnapshotManager,
  "getAgentManagerProviderState" | "resolveCreateConfig"
>;

/** Own only a fresh provider session, never a user's chat. Native startup customizations retain
 * their normal provider semantics; this is not the separately parked isolation policy. No Otto
 * tool catalog is attached. Every surfaced permission is denied instead of waiting for a user. */
export function createArtifactGeneration(ports: {
  providers: Providers;
  candidates(cwd: string): Promise<readonly StructuredGenerationProvider[]>;
}): ArtifactGeneration {
  return async (request) => {
    request.signal.throwIfAborted();
    const candidates = request.selection
      ? [request.selection]
      : await ports.candidates(request.cwd);
    for (const candidate of candidates) {
      request.signal.throwIfAborted();
      const client = ports.providers.getAgentManagerProviderState().clients[candidate.provider];
      if (!client) continue;
      // Resolve the provider's own unattended behavior. Never inherit a chat's permission mode.
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
        ...candidate,
        ...resolved,
        cwd: request.cwd,
        internal: true,
        mcpServers: {},
        title: "Artifact generation",
        systemPrompt:
          "Return only the requested HTML document as JSON. Do not use tools, modify files, start processes, or perform external actions. Otto persists the returned document.",
      };
      // One selected provider owns this attempt. A failure never silently spends on another model.
      const session = await client.createSession(config, {}, { persistSession: false });
      const result = await runArtifactSession(session, request);
      return { ...result, provider: candidate.provider, model: config.model ?? null };
    }
    throw new Error("No configured Artifact generation provider is available.");
  };
}

async function runArtifactSession(session: AgentSession, request: ArtifactGenerationRequest) {
  let closing: Promise<void> | undefined;
  const close = () => (closing ??= session.close());
  const cancel = () => {
    // Interrupt and close the owned session even when a provider run does not settle promptly.
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
        schema: z.object({ html: z.string().min(50).max(320000) }).strict(),
        schemaName: "OttoArtifact",
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
