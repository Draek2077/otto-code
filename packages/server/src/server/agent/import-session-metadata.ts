const METADATA_GENERATION_PROMPT_PREFIX =
  "Generate metadata for a coding agent based on the user prompt.";

export function isMetadataGenerationSession(input: { firstPromptPreview: string | null }): boolean {
  return (
    input.firstPromptPreview?.trimStart().startsWith(METADATA_GENERATION_PROMPT_PREFIX) ?? false
  );
}

export interface DiscoveryImportContext {
  knownImportedSessionCount: number;
  isImported: (nativeId: string) => boolean;
}
