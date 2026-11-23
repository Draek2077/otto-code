import { generateProviderContextText } from "@getpaseo/plugin/server/otto-openai";
import { getStructuredAgentResponse } from "../../agent/agent-response-loop.js";
import type { StructuredTextGeneration } from "../../session/checkout/git-metadata-generator.js";
import {
  CONTEXT_GENERATION_ISOLATION_MESSAGE,
  ContextGenerationIsolationUnavailable,
} from "./generation-isolation.js";

export interface ContextTextGenerationPorts {
  providerOwner(provider: string): string | undefined;
  invoke(pluginId: string, method: string, input: unknown): Promise<unknown>;
  candidates(cwd: string): Promise<{ provider: string; model?: string }[]>;
  native?(input: {
    provider: string;
    model?: string;
    cwd: string;
    prompt: string;
  }): Promise<string>;
}
/** Only this owned error carries user-safe recovery copy across the generation boundary. */
export class ContextTextGenerationUnavailable extends Error {}
/** Use a provider-owned text-only operation. Never fall through to a normal tool-capable agent session. */
export function createContextTextGeneration(
  ports: ContextTextGenerationPorts,
  selection?: { provider: string; model: string },
): StructuredTextGeneration {
  return {
    async generate(request) {
      const candidates = selection ? [selection] : await ports.candidates(request.cwd);
      for (const candidate of candidates) {
        const owner = ports.providerOwner(candidate.provider);
        if (!owner && !ports.native) continue;
        try {
          return await getStructuredAgentResponse({
            prompt: request.prompt,
            schema: request.schema,
            schemaName: request.schemaName,
            maxRetries: 2,
            caller: async (prompt) => {
              if (!owner && ports.native)
                return ports.native({ ...candidate, cwd: request.cwd, prompt });
              if (!owner) throw new Error("No provider-owned generation contract.");
              const result = generateProviderContextText.output.parse(
                await ports.invoke(owner, generateProviderContextText.name, {
                  providerId: candidate.provider,
                  model: candidate.model,
                  prompt,
                }),
              );
              if (!result.ok) throw new Error(result.error.message);
              return result.value.text;
            },
          });
        } catch (error) {
          if (selection && error instanceof ContextGenerationIsolationUnavailable)
            throw new ContextTextGenerationUnavailable(CONTEXT_GENERATION_ISOLATION_MESSAGE, {
              cause: error,
            });
          /* The caller receives bounded recovery copy, never provider stderr or credentials. */
        }
      }
      throw new ContextTextGenerationUnavailable(
        "Read-only proposal generation is unavailable for this selection. Check the selected provider and model configuration. Normal writable chat sessions are never used as a substitute.",
      );
    },
  };
}
