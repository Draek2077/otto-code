import { z } from "zod";
import {
  createArtifactCompletion,
  type ArtifactCompletionPorts,
  type ArtifactCompletionRequest,
} from "./completion.js";
export type ArtifactGenerationRequest = ArtifactCompletionRequest;
export interface ArtifactGenerationResult {
  html: string;
  provider: string;
  model: string | null;
}
export type ArtifactGeneration = (
  request: ArtifactGenerationRequest,
) => Promise<ArtifactGenerationResult>;
/** Existing HTML generation retains its provider/session semantics. */
export function createArtifactGeneration(ports: ArtifactCompletionPorts): ArtifactGeneration {
  const complete = createArtifactCompletion(ports, {
    schema: z.object({ html: z.string().min(50).max(320000) }).strict(),
    schemaName: "OttoArtifact",
    title: "Artifact generation",
    systemPrompt:
      "Return only the requested HTML document as JSON. Do not use tools, modify files, start processes, or perform external actions. Otto persists the returned document.",
  });
  return async (request) => {
    const result = await complete(request);
    return { ...result.value, provider: result.provider, model: result.model };
  };
}
