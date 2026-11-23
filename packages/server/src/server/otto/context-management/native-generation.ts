import type { AgentClient, AgentSession, AgentStreamEvent } from "../../agent/agent-sdk-types.js";
import type { AgentManagerProviderState } from "../../agent/provider-snapshot-manager.js";
import { withTimeout } from "../../../utils/promise-timeout.js";
import { ContextGenerationIsolationUnavailable } from "./generation-isolation.js";
import {
  NATIVE_CONTEXT_OUTPUT_LIMIT,
  NATIVE_CONTEXT_TIMEOUT_MS,
  nativeReadOnlyConfig,
} from "./native-generation-policy.js";

interface Candidate {
  provider: string;
  model?: string;
  cwd: string;
  prompt: string;
}
// A read-only tool policy alone does not isolate provider startup customizations.
// Codex/OpenCode retain their policies for future dedicated utility adapters;
// their ordinary session path is not admitted to isolated Context generation.
const ISOLATED_SESSION_FAMILIES = new Set(["claude", "pi", "omp"]);

/** Resolve only declared aliases. No ID substring, native chat resume, or parallel provider registry. */
export function nativeGenerationFamily(
  state: Pick<AgentManagerProviderState, "providerDefinitions">,
  provider: string,
): string | null {
  const visited = new Set<string>();
  let current = provider;
  while (!visited.has(current)) {
    visited.add(current);
    const definition = state.providerDefinitions[current];
    if (!definition || (current === provider && !definition.enabled)) return null;
    if (!definition.derivedFromProviderId) return current;
    current = definition.derivedFromProviderId;
  }
  return null;
}

/** Fresh provider-owned utility sessions; never register a chat or attach Otto's tool catalog. */
export function createNativeContextGeneration(readState: () => AgentManagerProviderState) {
  return async (candidate: Candidate): Promise<string> => {
    const state = readState();
    const family = nativeGenerationFamily(state, candidate.provider);
    const client = state.clients[candidate.provider];
    if (!client || !family) throw new Error("Context generation provider is unavailable.");
    if (client.ottoGenerateContextText) {
      return checkedText(
        await withTimeout(
          client.ottoGenerateContextText({
            ...candidate,
            signal: AbortSignal.timeout(NATIVE_CONTEXT_TIMEOUT_MS),
          }),
          NATIVE_CONTEXT_TIMEOUT_MS,
          "Context generation timed out.",
        ),
      );
    }
    if (!ISOLATED_SESSION_FAMILIES.has(family)) throw new ContextGenerationIsolationUnavailable();
    return runReadOnlySession(client, family, candidate);
  };
}

function checkedText(text: string): string {
  if (!text.trim() || Buffer.byteLength(text, "utf8") > NATIVE_CONTEXT_OUTPUT_LIMIT) {
    throw new Error("Context generation returned empty or oversized text.");
  }
  return text;
}

async function runReadOnlySession(
  client: AgentClient,
  family: string,
  candidate: Candidate,
): Promise<string> {
  let session: AgentSession | undefined;
  let release: (() => void) | undefined;
  let finished = false;
  let streamedBytes = 0;
  let rejected = false;
  const close = async () => {
    await session?.close();
  };
  const work = async () => {
    const created = await client.createSession(
      nativeReadOnlyConfig(family, {
        provider: candidate.provider,
        cwd: candidate.cwd,
        model: candidate.model,
      }),
      { ottoReadOnlyGeneration: true },
      { persistSession: false },
    );
    if (finished) {
      await created.close();
      throw new Error("Context generation expired during startup.");
    }
    session = created;
    const observe = (event: AgentStreamEvent) => {
      if (event.type === "permission_requested") {
        void created
          .respondToPermission(event.request.id, {
            behavior: "deny",
            message: "Context proposal generation is read-only.",
          })
          .catch(() => {
            rejected = true;
          });
      }
      if (event.type === "timeline" && event.item.type === "assistant_message") {
        streamedBytes += Buffer.byteLength(event.item.text, "utf8");
        if (streamedBytes > NATIVE_CONTEXT_OUTPUT_LIMIT) {
          rejected = true;
          void created.interrupt().catch(() => undefined);
        }
      }
    };
    release = created.subscribe(observe);
    const result = await created.run(candidate.prompt);
    if (rejected || result.canceled)
      throw new Error("Context generation did not complete within its text-only bounds.");
    return checkedText(result.finalText);
  };
  try {
    return await withTimeout(work(), NATIVE_CONTEXT_TIMEOUT_MS, "Context generation timed out.");
  } finally {
    finished = true;
    release?.();
    await withTimeout(close(), 5000, "Context generation runtime did not close.");
  }
}
